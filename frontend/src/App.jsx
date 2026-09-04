import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';

function normalizarTelefone(telefone) {
  return telefone.replace(/\D/g, '');
}

function foiCriadoHoje(lembrete) {
  const data = lembrete.criadoEm?.toDate
    ? lembrete.criadoEm.toDate()
    : new Date(lembrete.criadoEm);
  const hoje = new Date();

  return Number.isFinite(data.getTime())
    && data.getFullYear() === hoje.getFullYear()
    && data.getMonth() === hoje.getMonth()
    && data.getDate() === hoje.getDate();
}

function horariosDoLembrete(lembrete) {
  return lembrete.horarios || (lembrete.horario ? lembrete.horario.split(',').map((horario) => horario.trim()) : []);
}

function App() {
  const [telefone, setTelefone] = useState(() => localStorage.getItem('healthhub-telefone') || '');
  const [telefoneConsultado, setTelefoneConsultado] = useState('');
  const [lembretes, setLembretes] = useState([]);
  const [erro, setErro] = useState('');
  const [notificacoesPermitidas, setNotificacoesPermitidas] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  useEffect(() => {
    if (!db || !telefoneConsultado) return undefined;

    const lembretesQuery = query(
      collection(db, 'lembretes'),
      where('telefone', '==', telefoneConsultado)
    );

    return onSnapshot(lembretesQuery, (snapshot) => {
      const dados = snapshot.docs.map((documento) => ({ id: documento.id, ...documento.data() }));
      dados.sort((a, b) => (a.horario || '').localeCompare(b.horario || ''));
      setLembretes(dados);
      setErro('');
    }, () => {
      setErro('Não foi possível consultar os lembretes. Verifique as regras do Firestore.');
    });
  }, [telefoneConsultado]);

  useEffect(() => {
    if (!notificacoesPermitidas || lembretes.length === 0) return undefined;

    const verificarHorarios = () => {
      const agora = new Date();
      const horarioAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
      const chaveData = agora.toISOString().slice(0, 10);

      lembretes.forEach((lembrete) => {
        if (!horariosDoLembrete(lembrete).includes(horarioAtual)) return;
        const chave = `healthhub-notificacao-${lembrete.id}-${chaveData}-${horarioAtual}`;
        if (localStorage.getItem(chave)) return;

        new Notification(`Hora do remédio: ${lembrete.medicamento}`, {
          body: `Seu lembrete está marcado para ${horarioAtual}.`,
          tag: chave,
        });
        localStorage.setItem(chave, 'enviada');
      });
    };

    verificarHorarios();
    const intervalo = setInterval(verificarHorarios, 15 * 1000);
    return () => clearInterval(intervalo);
  }, [lembretes, notificacoesPermitidas]);

  function consultarLembretes(event) {
    event.preventDefault();
    const numero = normalizarTelefone(telefone);
    if (numero.length < 8) {
      setErro('Informe um número de WhatsApp válido, com DDD.');
      return;
    }
    localStorage.setItem('healthhub-telefone', numero);
    setErro('');
    setTelefoneConsultado(numero);
  }

  async function ativarNotificacoes() {
    if (typeof Notification === 'undefined') {
      setErro('Seu navegador não oferece suporte a notificações.');
      return;
    }
    const permissao = await Notification.requestPermission();
    setNotificacoesPermitidas(permissao === 'granted');
    if (permissao !== 'granted') setErro('Permissão para notificações não concedida.');
  }

  const proximoHorario = lembretes[0]?.horarios?.[0] || lembretes[0]?.horario || '--:--';
  const lembretesHoje = lembretes.filter(foiCriadoHoje);

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="brand-mark" aria-hidden="true">+</span>
        <div>
          <p className="eyebrow">HealthHub</p>
          <h1>Organize o cuidado diário</h1>
        </div>
      </header>

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div>
          <p className="eyebrow">Painel de saúde</p>
          <h2 id="welcome-title">Ajudamos a manter seu tratamento em dia.</h2>
          <p className="panel-copy">Consulte os lembretes associados ao seu WhatsApp.</p>
        </div>
        <div className="status-chip"><span /> Bot conectado</div>
      </section>

      <form className="phone-form" onSubmit={consultarLembretes}>
        <label htmlFor="telefone">Número do WhatsApp</label>
        <div>
          <input id="telefone" value={telefone} onChange={(event) => setTelefone(event.target.value)} placeholder="5511999999999" inputMode="tel" />
          <button type="submit">Ver lembretes</button>
        </div>
      </form>

      <button className="notification-button" type="button" onClick={ativarNotificacoes} disabled={notificacoesPermitidas}>
        {notificacoesPermitidas ? 'Notificações ativadas' : 'Ativar notificações do navegador'}
      </button>

      {erro && <p className="error-message" role="alert">{erro}</p>}
      {!firebaseConfigured && <p className="error-message" role="alert">Configure as variáveis VITE_FIREBASE_* na Vercel para conectar o site ao Firebase.</p>}

      <section className="summary-grid" aria-label="Resumo">
        <article className="summary-card accent-card">
          <span className="card-label">Próximo lembrete</span>
          <strong>{proximoHorario}</strong>
          <span>{lembretes[0]?.medicamento || 'Nenhum lembrete encontrado'}</span>
        </article>
        <article className="summary-card">
          <span className="card-label">Hoje</span>
          <strong>{lembretesHoje.length}</strong>
          <span>{lembretesHoje.length === 1 ? 'lembrete registrado' : 'lembretes registrados'}</span>
        </article>
      </section>

      {lembretes.length > 0 ? (
        <section className="reminder-list" aria-label="Lembretes">
          {lembretes.map((lembrete) => (
            <article className="reminder-item" key={lembrete.id}>
              <div><strong>{lembrete.medicamento}</strong><span>{lembrete.nome || 'Usuário'}</span></div>
              <time>{lembrete.horarios?.join(', ') || lembrete.horario}</time>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state" aria-labelledby="empty-title">
          <div className="empty-icon" aria-hidden="true">⌁</div>
          <h2 id="empty-title">{telefoneConsultado ? 'Nenhum lembrete encontrado' : 'Informe seu WhatsApp'}</h2>
          <p>Os lembretes gravados pelo bot aparecerão aqui.</p>
        </section>
      )}
    </main>
  );
}

export default App;
