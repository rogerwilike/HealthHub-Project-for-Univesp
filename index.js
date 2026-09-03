import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason 
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = geminiApiKey
    ? new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({ model: 'gemini-3.6-flash' })
    : null;

// ==========================================
// 2. Parser de Texto e Gravação no Banco
// ==========================================
async function extrairLembreteComGemini(texto) {
    if (!geminiModel) return null;

    const prompt = `
Extraia um lembrete de medicamento da mensagem abaixo.
Responda apenas com JSON válido neste formato: {"medicamento": string|null, "horario": string|null}.
Use horário 24 horas no formato HH:MM. Se a mensagem não contiver medicamento e horário, use null nos campos.
Não invente informações.

Mensagem: ${texto}
    `;

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
            const result = await geminiModel.generateContent(prompt);
            const resposta = result.response.text().replace(/^```json\s*|\s*```$/g, '').trim();
            const lembrete = JSON.parse(resposta);

            if (typeof lembrete.medicamento !== 'string' || !/^\d{1,2}:\d{2}$/.test(lembrete.horario)) {
                return null;
            }

            return {
                medicamento: lembrete.medicamento.trim(),
                horario: lembrete.horario.trim()
            };
        } catch (err) {
            const indisponivel = err.message.includes('503') || err.message.includes('Service Unavailable');
            if (!indisponivel || tentativa === 2) {
                console.warn('Gemini indisponível; usando o parser local:', err.message);
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
    const dadosGemini = await extrairLembreteComGemini(texto);

    if (match || dadosGemini) {
        const medicamento = dadosGemini?.medicamento || match[1].trim();
        const horario = dadosGemini?.horario || match[2].trim();
        const numeroTelefone = jid.split('@')[0]; // Extrai o número puro sem o sufixo @s.whatsapp.net

        try {
            await db.collection('lembretes').add({
                telefone: numeroTelefone,
                medicamento: medicamento,
                horario: horario,
                textoOriginal: texto,
                criadoEm: new Date()
            });

            return `✅ Registrado com sucesso!\n\n💊 *Remédio:* ${medicamento}\n⏰ *Horário:* ${horario}`;
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
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignora mensagens enviadas pelo próprio bot ou de status/broadcast
            if (msg.key.fromMe || msg.key.remoteJid.includes('@broadcast')) continue;

            // Extrai o conteúdo textual
            const textoMensagem = 
                msg.message?.conversation || 
                msg.message?.extendedTextMessage?.text;

            if (!textoMensagem) continue;

            const remetente = msg.key.remoteJid;
            console.log(`[Mensagem Recebida] De: ${remetente} | Texto: ${textoMensagem}`);

            // Processa a mensagem e envia para o banco
            const resposta = await processarEGravarMensagem(remetente, textoMensagem);

            // Responde o usuário no WhatsApp
            await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });
        }
    });
}

iniciarBot();