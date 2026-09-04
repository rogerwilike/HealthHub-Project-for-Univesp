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
    NOME: 'nome',
    MEDICAMENTO: 'medicamento',
    FREQUENCIA: 'frequencia',
    HORARIOS: 'horarios',
    CONFIRMACAO: 'confirmacao'
};

function menu() {
    return '🏥 *HealthHub*\n\nEscolha uma opção:\n\n1 - Cadastrar lembrete\n2 - Ajuda\n0 - Cancelar';
}

function extrairNumeroDoJid(jid) {
    return jid?.split('@')[0] || '';
}

async function obterTelefoneDoContato(msg) {
    const jid = msg.key.remoteJid || '';
    const jidAlternativo = msg.key.remoteJidAlt || msg.key.participantAlt;

    if (jidAlternativo) return extrairNumeroDoJid(jidAlternativo);
    if (!jid.endsWith('@lid')) return extrairNumeroDoJid(jid);

    const lid = extrairNumeroDoJid(jid);
    try {
        const arquivoMapa = new URL(`./auth_info_baileys/lid-mapping-${lid}_reverse.json`, import.meta.url);
        const telefone = JSON.parse(fs.readFileSync(arquivoMapa, 'utf8'));
        if (typeof telefone === 'string') return telefone;
    } catch (err) {
        console.warn(`Não foi possível resolver o LID ${lid}:`, err.message);
    }

    return lid;
}

function extrairHorarios(texto) {
    const horarios = [];
    const padrao = /(?:^|[\s,;])([01]?\d|2[0-3])(?::([0-5]\d))?(?=$|[\s,;])/g;
    for (const correspondencia of texto.matchAll(padrao)) {
        const hora = correspondencia[1].padStart(2, '0');
        const minutos = correspondencia[2] || '00';
        horarios.push(`${hora}:${minutos}`);
    }
    return [...new Set(horarios)];
}

function horarioAtual() {
    const agora = new Date();
    return `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
}

function chaveDaNotificacao() {
    const agora = new Date();
    return `${agora.toISOString().slice(0, 10)}-${horarioAtual()}`;
}

async function enviarNotificacoesPendentes(sock) {
    const horario = horarioAtual();
    const chave = chaveDaNotificacao();
    const snapshot = await db.collection('lembretes').where('horarios', 'array-contains', horario).get();

    for (const documento of snapshot.docs) {
        const lembrete = documento.data();
        const telefone = lembrete.telefone;
        if (!telefone || telefone.includes('@')) continue;

        const referencia = db.collection('lembretes').doc(documento.id);
        const deveEnviar = await db.runTransaction(async (transacao) => {
            const atual = await transacao.get(referencia);
            if (atual.data()?.ultimaNotificacao === chave) return false;
            transacao.update(referencia, { ultimaNotificacao: chave });
            return true;
        });

        if (!deveEnviar) continue;

        try {
            await sock.sendMessage(`${telefone}@s.whatsapp.net`, {
                text: `⏰ *Hora do remédio!*\n\n💊 ${lembrete.medicamento}\n\nEste é o horário que você informou para tomar seu medicamento.`
            });
            console.log(`[Notificação enviada] ${telefone} - ${lembrete.medicamento} - ${horario}`);
        } catch (err) {
            console.error(`Erro ao enviar notificação para ${telefone}:`, err.message);
        }
    }
}

function formatarResumo(dados) {
    return `Confira os dados do lembrete:\n\n👤 *Nome:* ${dados.nome}\n💊 *Remédio:* ${dados.medicamento}\n🔁 *Frequência:* ${dados.frequencia} vez(es) ao dia\n⏰ *Horários:* ${dados.horarios.join(', ')}\n\n1 - Confirmar\n2 - Corrigir\n0 - Cancelar`;
}

function iniciarCadastro(jid, telefone) {
    estados.set(jid, { estado: ESTADOS.NOME, telefone, dados: {} });
    return '📝 Vamos cadastrar um lembrete.\n\nQual é o seu nome?';
}

async function salvarLembrete(jid, dados, telefone) {
    const numeroTelefone = telefone || extrairNumeroDoJid(jid);

    try {
        await db.collection('lembretes').add({
            telefone: numeroTelefone,
            nome: dados.nome,
            medicamento: dados.medicamento,
            horario: dados.horarios.join(', '),
            frequencia: dados.frequencia,
            horarios: dados.horarios,
            criadoEm: new Date()
        });

        estados.delete(jid);
        return `✅ Lembrete registrado com sucesso!\n\n👤 *Nome:* ${dados.nome}\n💊 *Remédio:* ${dados.medicamento}\n⏰ *Horários:* ${dados.horarios.join(', ')}\n\nDigite qualquer mensagem para voltar ao menu.`;
    } catch (err) {
        console.error('Erro ao salvar no Firestore:', err);
        return '❌ Ocorreu um erro ao salvar o lembrete. Tente novamente pelo menu.';
    }
}
// ==========================================
// 2. Máquina de Estados e Gravação no Banco
// ==========================================
async function processarMensagem(jid, texto, telefone) {
    const entrada = texto.trim().toLowerCase();
    const sessao = estados.get(jid);

    if (entrada === '0' || entrada === 'cancelar') {
        estados.delete(jid);
        return 'Cadastro cancelado.\n\n' + menu();
    }

    if (!sessao) {
        if (entrada === '1') return iniciarCadastro(jid, telefone);
        if (entrada === '2' || entrada === 'ajuda') {
            return 'ℹ️ Escolha *1* no menu para cadastrar um lembrete.\nDurante o cadastro, use *0* para cancelar.\n\n' + menu();
        }
        return menu();
    }

    switch (sessao.estado) {
        case ESTADOS.NOME:
            if (entrada.length < 2 || /^\d+$/.test(entrada)) {
                return 'Digite um nome válido. Exemplo: Maria Silva.';
            }
            sessao.dados.nome = texto.trim();
            sessao.estado = ESTADOS.MEDICAMENTO;
            return 'Digite o nome do medicamento (inclua a dosagem, se quiser):';

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
            return `Informe ${frequencia === 1 ? 'o horário' : 'os ' + frequencia + ' horários'} como hora inteira ou no formato HH:MM, separados por vírgula.\n\nExemplo: 8${frequencia > 1 ? ', 14:30' : ''}`;
        }

        case ESTADOS.HORARIOS: {
            const horarios = extrairHorarios(texto);
            if (horarios.length !== sessao.dados.frequencia) {
                return `Informe exatamente ${sessao.dados.frequencia} horário(s) válidos. Você pode usar 8, 14:30 ou 20.`;
            }
            sessao.dados.horarios = horarios;
            sessao.estado = ESTADOS.CONFIRMACAO;
            return formatarResumo(sessao.dados);
        }

        case ESTADOS.CONFIRMACAO:
            if (entrada === '1' || entrada === 'sim') return salvarLembrete(jid, sessao.dados, sessao.telefone);
            if (entrada === '2' || entrada === 'corrigir') return iniciarCadastro(jid, sessao.telefone);
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
            enviarNotificacoesPendentes(sock).catch((err) => {
                console.error('Erro no agendador de notificações:', err.message);
            });
            setInterval(() => {
                enviarNotificacoesPendentes(sock).catch((err) => {
                    console.error('Erro no agendador de notificações:', err.message);
                });
            }, 60 * 1000);
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
            const telefone = await obterTelefoneDoContato(msg);

            // Extrai o conteúdo textual
            const textoMensagem = 
                msg.message?.conversation || 
                msg.message?.extendedTextMessage?.text;

            if (!textoMensagem) continue;

            console.log(`[Mensagem Recebida] De: ${remetente} | Telefone: ${telefone} | Texto: ${textoMensagem}`);

            try {
                const resposta = await processarMensagem(remetente, textoMensagem, telefone);

                // Responde o usuário no WhatsApp
                await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });
            } catch (err) {
                console.error('Erro ao processar mensagem:', err);
            }
        }
    });
}

iniciarBot();