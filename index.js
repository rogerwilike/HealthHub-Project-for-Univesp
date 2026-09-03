import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason 
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

// ==========================================
// 1. Inicialização do Firebase Firestore
// ==========================================
const serviceAccount = JSON.parse(
    fs.readFileSync(new URL('./firebase-key.json', import.meta.url))
);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const xaiApiKey = process.env.XAI_API_KEY;
const xaiModel = process.env.XAI_MODEL || 'grok-3-mini';
const lembretesPendentes = new Map();

// ==========================================
// 2. Parser de Texto e Gravação no Banco
// ==========================================
async function extrairLembreteComGrok(texto) {
    if (!xaiApiKey) return null;

    const prompt = `
Você é o assistente de lembretes de medicamentos. Analise a mensagem em português e identifique a intenção mesmo quando ela for informal, tiver erros de digitação ou não seguir um formato fixo.

Extraia o nome do medicamento, a frequência e todos os horários mencionados.
Converta horários informais para o formato 24 horas HH:MM: "às oito da manhã" vira "08:00", "duas da tarde" vira "14:00" e "meio-dia" vira "12:00".
Entenda frases como "me lembra de tomar dipirona amanhã às 9", "vou tomar meu remédio às 18h" e "tome dipirona 3 vezes ao dia".
Em "3 vezes ao dia", retorne frequencia como 3 e horarios como []. Se houver horários explícitos, coloque todos no array horarios.
Para horários vagos ou ausentes, use []. Para frequência ausente, use null.
Não invente medicamento, horário ou frequência. Responda apenas com JSON válido neste formato: {"medicamento": string|null, "frequencia": number|null, "horarios": string[]}.

Mensagem: ${texto}
    `;

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
            const response = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${xaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: xaiModel,
                    temperature: 0,
                    messages: [
                        { role: 'system', content: 'Você extrai lembretes de medicamentos em português e responde somente com JSON válido.' },
                        { role: 'user', content: prompt }
                    ]
                })
            });

            if (!response.ok) {
                const detalhe = await response.text();
                const erro = new Error(`HTTP ${response.status}: ${detalhe}`);
                erro.status = response.status;
                throw erro;
            }

            const result = await response.json();
            const resposta = result.choices?.[0]?.message?.content
                ?.replace(/^```json\s*|\s*```$/g, '')
                .trim();
            if (!resposta) return null;

            const lembrete = JSON.parse(resposta);

            const horarios = Array.isArray(lembrete.horarios)
                ? lembrete.horarios.filter((horario) => /^\d{1,2}:\d{2}$/.test(horario))
                : [];

            if (typeof lembrete.medicamento !== 'string' || (!horarios.length && !Number.isInteger(lembrete.frequencia))) {
                return null;
            }

            return {
                medicamento: lembrete.medicamento.trim(),
                frequencia: Number.isInteger(lembrete.frequencia) ? lembrete.frequencia : null,
                horarios
            };
        } catch (err) {
            const indisponivel = err.status === 429 || err.status >= 500 || err.message.includes('Service Unavailable');
            if (!indisponivel || tentativa === 2) {
                console.warn('Grok indisponível; usando o parser local:', err.message);
                return null;
            }

            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }
}

async function processarEGravarMensagem(jid, texto) {
    // Regex para capturar formatos como:
    // "Tomar Paracetamol 500mg às 08:00" ou "Dipirona as 14:30"
    const regex = /(?:tomar|remedio)?\s*([a-zA-ZÀ-ÿ0-9\s]+?)\s+(?:às|as|horario|horário)\s+(\d{1,2}:\d{2})/i;
    const match = texto.match(regex);
    const pendente = lembretesPendentes.get(jid);
    const textoParaInterpretar = pendente
        ? `Medicamento pendente: ${pendente.medicamento}. Frequência pendente: ${pendente.frequencia} vezes ao dia. Horários informados agora: ${texto}`
        : texto;
    const dadosGrok = await extrairLembreteComGrok(textoParaInterpretar);

    if (dadosGrok?.medicamento && dadosGrok.frequencia && !dadosGrok.horarios.length) {
        lembretesPendentes.set(jid, {
            medicamento: dadosGrok.medicamento,
            frequencia: dadosGrok.frequencia
        });
        return `💊 Entendi: *${dadosGrok.medicamento}*, ${dadosGrok.frequencia} vezes ao dia.\n\nQuais horários você deseja usar? Exemplo: 08:00, 14:00 e 20:00.`;
    }

    if (match || dadosGrok) {
        lembretesPendentes.delete(jid);
        const medicamento = dadosGrok?.medicamento || match[1].trim();
        const horarios = dadosGrok?.horarios?.length ? dadosGrok.horarios : [match[2].trim()];
        const horario = horarios.join(', ');
        const numeroTelefone = jid.split('@')[0]; // Extrai o número puro sem o sufixo @s.whatsapp.net

        try {
            await db.collection('lembretes').add({
                telefone: numeroTelefone,
                medicamento: medicamento,
                horario: horario,
                frequencia: dadosGrok?.frequencia || horarios.length,
                horarios: horarios,
                textoOriginal: texto,
                criadoEm: new Date()
            });

            return `✅ Registrado com sucesso!\n\n💊 *Remédio:* ${medicamento}\n⏰ *Horários:* ${horario}`;
        } catch (err) {
            console.error('Erro ao salvar no Firestore:', err);
            return '❌ Ocorreu um erro ao salvar o lembrete no banco de dados.';
        }
    }

    return '⚠️ Não compreendi o padrão. Envie no formato:\n*Nome do Remédio às HH:MM*\n\n_Exemplo: Dipirona 500mg às 14:00_';
}

// ==========================================
// 3. Conexão do Bot WhatsApp (Baileys)
// ==========================================
async function iniciarBot() {
    // Salva a sessão localmente na pasta "auth_info_baileys"
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Gerenciamos o QR manualmente via qrcode-terminal
        logger: pino({ level: 'silent' }) // Silencia logs verbosos de rede
    });

    // Evento de conexão e autenticação
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📲 Escaneie o QR Code abaixo com o seu WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão encerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                iniciarBot();
            }
        } else if (connection === 'open') {
            console.log('🚀 Bot conectado com sucesso ao WhatsApp!');
        }
    });

    // Salva atualizações das credenciais de autenticação
    sock.ev.on('creds.update', saveCreds);

    // Evento de recebimento de mensagens
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`[Evento WhatsApp] messages.upsert: ${type}, ${messages.length} mensagem(ns)`);
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignora mensagens enviadas pelo próprio bot ou de status/broadcast
            const remetente = msg.key.remoteJid;
            if (!remetente) continue;
            if (msg.key.fromMe || remetente.includes('@broadcast')) continue;

            // Extrai o conteúdo textual
            const textoMensagem = 
                msg.message?.conversation || 
                msg.message?.extendedTextMessage?.text;

            if (!textoMensagem) continue;

            console.log(`[Mensagem Recebida] De: ${remetente} | Texto: ${textoMensagem}`);

            try {
                // Processa a mensagem e envia para o banco
                const resposta = await processarEGravarMensagem(remetente, textoMensagem);

                // Responde o usuário no WhatsApp
                await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });
            } catch (err) {
                console.error('Erro ao processar mensagem:', err);
            }
        }
    });
}

iniciarBot();