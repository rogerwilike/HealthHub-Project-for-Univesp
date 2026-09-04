import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';

function normalizarTelefone(telefone) {
  return telefone.replace(/\D/g, '');
}

function App() {
  const [telefone, setTelefone] = useState(() => localStorage.getItem('healthhub-telefone') || '');
  const [telefoneConsultado, setTelefoneConsultado] = useState('');
  const [lembretes, setLembretes] = useState([]);
  const [erro, setErro] = useState('');

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

  const proximoHorario = lembretes[0]?.horarios?.[0] || lembretes[0]?.horario || '--:--';

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
          <h2 id="welcome-title">Seus lembretes em um só lugar.</h2>
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
          <strong>{lembretes.length}</strong>
          <span>{lembretes.length === 1 ? 'lembrete registrado' : 'lembretes registrados'}</span>
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
