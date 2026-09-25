# **Último update:** 25/09/2026

Clone público para portfólio do repositório privado original [`Fantasy-Futebol`](https://github.com/FranciscoSimas/Fantasy-Futebol). Mesmo snapshot de código, sem histórico git.

# ⚽ Predz

**Adivinha. Compete. Vence.**

App web de prognósticos de futebol entre amigos. Crias ou entras em torneios ligados a competições reais, fazes prognósticos e competes no ranking.

A marca do produto é **Predz**. O repositório privado original no GitHub ainda se chama `Fantasy-Futebol`.

## 📖 Sobre

Comecei a partir de um site privado de prognósticos do Mundial que fiz com amigos e transformei isto num produto real: domínio próprio, API de futebol paga, email, sync automático de jogos e uma app web completa. O Predz está em pausa por agora (quero tê-lo pronto antes das grandes épocas), mas o código e a infra estão vivos e penso continuar mais tarde (incluindo app na Play Store).

O login e os dados ficam no Supabase. A produção corre na Vercel em [predz.app](https://predz.app). Os dados de futebol são sincronizados com um programa em Go nos GitHub Actions.

## ✨ Funcionalidades principais

- 🔐 Autenticação (email/password + Google, confirmação e reset)
- 🏆 Criar e entrar em torneios (públicos ou privados com código)
- 🎯 Prognósticos partilhados entre torneios da mesma competição
- 📊 Ranking e pontuação em direto (resultado e placar exato)
- ⭐ Apostas especiais (campeão, melhor marcador e módulos relacionados)
- 👀 Modo espetador (ver sem prognosticar)
- ⏱️ Apoio a prolongamento / penáltis no knockout (UI de jornadas)
- 🛠️ Admin da plataforma (incluindo override manual de jogos)
- 🌍 Português e inglês
- 📱 Layout mobile first
- 📧 Caixa de suporte ligada a email profissional (Resend)

## 🛠️ Tecnologias utilizadas

### Frontend
- TanStack Start + TanStack Router
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- shadcn/ui
- TanStack Query
- React Hook Form + Zod

### Backend e dados
- Supabase (Auth, PostgreSQL, RLS, Realtime)
- Migrations SQL e RPCs para pontuação, bloqueios e ranking

### Sync e automação
- Serviço Go de sync (`sync/`)
- GitHub Actions (import diário + dispatch de matchday)
- Orquestrador Supabase `pg_cron` (só faz poll quando há jogos ativos)

### Hosting e email
- Vercel (`predz.app` em produção, branch `dev` para testes)
- Resend (emails de auth + suporte inbound)

## 📁 Estrutura do projeto

```
Predz-P/
├── public/                 # Brand, robots, sitemap
├── src/
│   ├── components/         # UI e componentes de features
│   ├── hooks/
│   ├── integrations/       # Clientes Supabase
│   ├── lib/                # Pontuação, i18n, helpers
│   └── routes/             # Rotas TanStack (app + auth + API)
├── supabase/migrations/    # Schema, RLS, orquestrador, scoring
├── sync/                   # Sync Go de dados de futebol
├── .github/workflows/      # CI e jobs do sync
├── .env.example
└── package.json
```

## 🔄 Sync de futebol (resumo)

| Job | O que faz |
|---|---|
| Daily | Equipas, calendário, plantéis, melhores marcadores |
| Matchday | Atualiza resultados em direto só quando algo mudou |
| Go CI | Testes do pacote sync em cada push |

Provider principal: API-Football. Opcional / legado: football-data.org.

## 📌 Estado atual

Nível soft launch / beta utilizável. O produto core funciona (auth, torneios, prognósticos, ranking, sync). Em pausa antes de marketing amplo. Próximas ideias: mais competições, UI de bracket no knockout, app Android com Capacitor.

## 🤝 Contribuir

Este é um produto pessoal. Sugestões são bem-vindas, mas neste momento não estou à procura de contribuidores ativos.

## 📄 Licença

Uso pessoal e educacional do código deste repositório. Dados de futebol e marcas dos clubes pertencem aos respetivos donos. O Predz é um projeto independente.

## 🔗 Links

- **App:** https://predz.app
- **Este clone público:** https://github.com/FranciscoSimas/Predz-P
- **Original privado:** https://github.com/FranciscoSimas/Fantasy-Futebol
- **README em inglês:** [README.md](README.md)
