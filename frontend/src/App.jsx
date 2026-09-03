function App() {
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
          <p className="panel-copy">O frontend está pronto para receber os dados do seu bot e do Firebase.</p>
        </div>
        <div className="status-chip"><span /> Bot conectado</div>
      </section>

      <section className="summary-grid" aria-label="Resumo">
        <article className="summary-card accent-card">
          <span className="card-label">Próximo lembrete</span>
          <strong>08:00</strong>
          <span>Configure sua primeira medicação</span>
        </article>
        <article className="summary-card">
          <span className="card-label">Hoje</span>
          <strong>0</strong>
          <span>lembretes registrados</span>
        </article>
      </section>

      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-icon" aria-hidden="true">⌁</div>
        <h2 id="empty-title">Nenhum lembrete ainda</h2>
        <p>Quando o backend estiver conectado, seus horários aparecerão aqui.</p>
      </section>
    </main>
  );
}

export default App;
