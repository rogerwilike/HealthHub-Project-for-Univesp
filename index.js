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
const estados = new Map();

const ESTADOS = {
    MEDICAMENTO: 'medicamento',
    FREQUENCIA: 'frequencia',
    HORARIOS: 'horarios',
    CONFIRMACAO: 'confirmacao'
};

function menu() {
    return '🏥 *HealthHub*\n\nEscolha uma opção:\n\n1 - Cadastrar lembrete\n2 - Ajuda\n0 - Cancelar';
}

function extrairHorarios(texto) {
    const horarios = texto.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
    return [...new Set(horarios)];
}

function formatarResumo(dados) {
    return `Confira os dados do lembrete:\n\n💊 *Remédio:* ${dados.medicamento}\n🔁 *Frequência:* ${dados.frequencia} vez(es) ao dia\n⏰ *Horários:* ${dados.horarios.join(', ')}\n\n1 - Confirmar\n2 - Corrigir\n0 - Cancelar`;
}

function iniciarCadastro(jid) {
    estados.set(jid, { estado: ESTADOS.MEDICAMENTO, dados: {} });
    return '📝 Vamos cadastrar um lembrete.\n\nDigite o nome do medicamento (inclua a dosagem, se quiser):';
}

async function salvarLembrete(jid, dados) {
    const numeroTelefone = jid.split('@')[0];

    try {
        await db.collection('lembretes').add({
            telefone: numeroTelefone,
            medicamento: dados.medicamento,
            horario: dados.horarios.join(', '),
            frequencia: dados.frequencia,
            horarios: dados.horarios,
            criadoEm: new Date()
        });

        estados.delete(jid);
        return `✅ Lembrete registrado com sucesso!\n\n💊 *Remédio:* ${dados.medicamento}\n⏰ *Horários:* ${dados.horarios.join(', ')}\n\nDigite qualquer mensagem para voltar ao menu.`;
    } catch (err) {
        console.error('Erro ao salvar no Firestore:', err);
        return '❌ Ocorreu um erro ao salvar o lembrete. Tente novamente pelo menu.';
    }
}
// ==========================================
// 2. Máquina de Estados e Gravação no Banco
// ==========================================
async function processarMensagem(jid, texto) {
    const entrada = texto.trim().toLowerCase();
    const sessao = estados.get(jid);

    if (entrada === '0' || entrada === 'cancelar') {
        estados.delete(jid);
        return 'Cadastro cancelado.\n\n' + menu();
    }

    if (!sessao) {
        if (entrada === '1') return iniciarCadastro(jid);
        if (entrada === '2' || entrada === 'ajuda') {
            return 'ℹ️ Escolha *1* no menu para cadastrar um lembrete.\nDurante o cadastro, use *0* para cancelar.\n\n' + menu();
        }
        return menu();
    }

    switch (sessao.estado) {
        case ESTADOS.MEDICAMENTO:
            if (entrada.length < 2 || /^\d+$/.test(entrada)) {
                return 'Digite um nome de medicamento válido. Exemplo: Dipirona 500mg.';
            }
            sessao.dados.medicamento = texto.trim();
            sessao.estado = ESTADOS.FREQUENCIA;
            return 'Quantas vezes ao dia você deseja receber o lembrete?\n\n1 - Uma vez\n2 - Duas vezes\n3 - Três vezes\n4 - Quatro vezes';

        case ESTADOS.FREQUENCIA: {
            const frequencia = Number(entrada);
            if (!Number.isInteger(frequencia) || frequencia < 1 || frequencia > 4) {
                return 'Escolha uma opção de 1 a 4 para a frequência.';
            }
            sessao.dados.frequencia = frequencia;
            sessao.estado = ESTADOS.HORARIOS;
            return `Informe ${frequencia === 1 ? 'o horário' : 'os ' + frequencia + ' horários'} no formato HH:MM, separados por vírgula.\n\nExemplo: 08:00${frequencia > 1 ? ', 14:00' : ''}`;
        }

        case ESTADOS.HORARIOS: {
            const horarios = extrairHorarios(texto);
            if (horarios.length !== sessao.dados.frequencia) {
                return `Informe exatamente ${sessao.dados.frequencia} horário(s) válidos no formato HH:MM.`;
            }
            sessao.dados.horarios = horarios;
            sessao.estado = ESTADOS.CONFIRMACAO;
            return formatarResumo(sessao.dados);
        }

        case ESTADOS.CONFIRMACAO:
            if (entrada === '1' || entrada === 'sim') return salvarLembrete(jid, sessao.dados);
            if (entrada === '2' || entrada === 'corrigir') return iniciarCadastro(jid);
            return 'Escolha 1 para confirmar, 2 para corrigir ou 0 para cancelar.';

        default:
            estados.delete(jid);
            return menu();
    }
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
                const resposta = await processarMensagem(remetente, textoMensagem);

                // Responde o usuário no WhatsApp
                await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });
            } catch (err) {
                console.error('Erro ao processar mensagem:', err);
            }
        }
    });
}

iniciarBot();