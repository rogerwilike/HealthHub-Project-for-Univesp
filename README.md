# HealthHub-Project-for-Univesp
Project with a web framework that uses a database, includes web scripting (Javascript), cloud, API usage, accessibility, version control, and testing. Proposal: Health Hub which solves disorganization of prescriptions, medication schedules, medical history, especially for those who take care of elderly people, kids and chronic illnesses.

## Configuração

O bot usa um menu numérico guiado por máquina de estados para cadastrar lembretes, sem dependência de serviços de IA:

```powershell
node index.js
```

No WhatsApp, escolha `1` para cadastrar, informe o medicamento, a frequência, os horários em `HH:MM` e confirme o resumo. Use `0` para cancelar em qualquer etapa.
