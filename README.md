# HealthHub-Project-for-Univesp
Project with a web framework that uses a database, includes web scripting (Javascript), cloud, API usage, accessibility, version control, and testing. Proposal: Health Hub which solves disorganization of prescriptions, medication schedules, medical history, especially for those who take care of elderly people, kids and chronic illnesses.

## Configuração

O bot usa o Grok para interpretar mensagens de lembretes. Configure a chave como variável de ambiente antes de iniciar:

```powershell
$env:XAI_API_KEY = "sua-chave-da-xai"
$env:XAI_MODEL = "grok-3-mini"
node index.js
```

O arquivo `.env.example` mostra o nome da variável esperada. O arquivo `.env` e outras variações estão ignorados pelo Git; não coloque chaves reais no código ou no repositório.
