import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade - Predz" },
      {
        name: "description",
        content:
          "Como a Predz trata dados pessoais (RGPD): conta, cookies, processadores e os teus direitos. Contacto: suporte@predz.app.",
      },
      { name: "robots", content: "index,follow,max-snippet:40" },
      { property: "og:title", content: "Política de Privacidade - Predz" },
      { property: "og:url", content: "https://predz.app/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://predz.app/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { locale, t } = useT();
  const en = locale === "en";

  return (
    <LegalPage title={t.legal.privacyTitle} updated={t.legal.privacyUpdated}>
      {en ? <PrivacyEn /> : <PrivacyPt />}
    </LegalPage>
  );
}

function PrivacyPt() {
  return (
    <>
      <p>
        Esta Política explica como a Predz trata dados pessoais, em conformidade com o
        Regulamento Geral sobre a Proteção de Dados (RGPD) e a Lei portuguesa n.º 58/2019.
      </p>
      <p>
        <strong>Responsável pelo tratamento:</strong> o operador da Predz. Contacto:{" "}
        <a href="mailto:suporte@predz.app">suporte@predz.app</a>.
      </p>
      <h2>1. Dados que recolhemos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> email, nome a mostrar, avatar (se usares Google OAuth ou
          o carregares), identificador de utilizador.
        </li>
        <li>
          <strong>Utilização:</strong> torneios em que participas, prognósticos, apostas
          especiais, roles (membro/admin), preferências (ex. tema, idioma).
        </li>
        <li>
          <strong>Técnicos:</strong> dados de sessão e autenticação (via Supabase Auth), logs
          de segurança, e, se aceitares, métricas agregadas de utilização (Vercel Analytics /
          Speed Insights).
        </li>
        <li>
          <strong>Comunicações:</strong> emails transacionais (confirmação de conta, reset de
          password) e mensagens que enviares para suporte@.
        </li>
      </ul>
      <p>Não pedimos dados de pagamento. A Predz não processa dinheiro.</p>
      <h2>2. Finalidades e bases legais</h2>
      <ul>
        <li>
          <strong>Prestação do serviço</strong> (contrato): criar conta, gerir torneios,
          calcular pontos e rankings.
        </li>
        <li>
          <strong>Interesse legítimo:</strong> segurança, prevenção de abuso, melhoria do
          produto, estatísticas agregadas essenciais ao funcionamento.
        </li>
        <li>
          <strong>Consentimento:</strong> analytics não essenciais (Vercel), quando aceitas no
          banner de cookies.
        </li>
        <li>
          <strong>Obrigação legal:</strong> responder a pedidos das autoridades quando a lei
          o exigir.
        </li>
      </ul>
      <h2>3. Menores</h2>
      <p>
        A Predz é entretenimento sem pagamentos nem prémios geridos pela plataforma. A idade
        mínima para conta é <strong>13 anos</strong>. Se tiveres entre 13 e 16 anos,
        recomenda-se o acompanhamento dos pais ou responsáveis. Não dirigimos a Predz a crianças
        com menos de 13 anos.
      </p>
      <h2>4. Cookies</h2>
      <ul>
        <li>
          <strong>Essenciais:</strong> sessão, autenticação, tema, idioma e preferências
          técnicas necessárias ao serviço.
        </li>
        <li>
          <strong>Opcionais:</strong> se escolheres <strong>«Aceitar todos»</strong> no
          banner, activamos Vercel Analytics e Speed Insights (métricas agregadas de
          utilização e desempenho) para melhorar o produto. Podes escolher «Só essenciais» e
          continuar a usar a Predz sem esses analytics.
        </li>
      </ul>
      <h2>5. Partilha com subprocessadores</h2>
      <p>Usamos prestadores que tratam dados em nosso nome, nomeadamente:</p>
      <ul>
        <li>
          <strong>Supabase</strong>: autenticação e base de dados (preferência UE / EEE);
        </li>
        <li>
          <strong>Vercel</strong>: alojamento do frontend e, com consentimento, analytics;
        </li>
        <li>
          <strong>Resend</strong>: envio e receção de email (Auth SMTP e suporte);
        </li>
        <li>
          <strong>Google</strong>: se escolheres login com Google (OAuth).
        </li>
      </ul>
      <p>
        Também usamos a <strong>API-Football / API-Sports</strong> (e, se aplicável, outras
        fontes de dados desportivos) para calendários, resultados, plantéis e estatísticas.
        Esses fornecedores tipicamente <strong>não recebem</strong> os teus dados pessoais de
        conta. Jobs de sincronização (ex. GitHub Actions) correm no nosso lado com chaves de
        API e não enviam o teu email ou perfil a esses serviços de dados.
      </p>
      <h2>6. Conservação</h2>
      <p>
        Mantemos os dados enquanto a conta estiver ativa e o tempo necessário para operar o
        serviço. Podes pedir eliminação da conta. Alguns registos podem ser retidos por um
        período limitado por motivos legais ou de segurança (ex. logs de abuso).
      </p>
      <h2>7. Os teus direitos (RGPD)</h2>
      <p>
        Podes solicitar acesso, retificação, apagamento, limitação, oposição, portabilidade e
        retirada de consentimento quando aplicável. Contacto:{" "}
        <a href="mailto:suporte@predz.app">suporte@predz.app</a>. Também podes reclamar junto
        da CNPD (
        <a href="https://www.cnpd.pt" target="_blank" rel="noreferrer">
          www.cnpd.pt
        </a>
        ).
      </p>
      <h2>8. Segurança</h2>
      <p>
        Aplicamos medidas técnicas e organizativas razoáveis (controlo de acesso, RLS, HTTPS).
        Reporta vulnerabilidades para o contacto acima.
      </p>
      <h2>9. Transferências internacionais</h2>
      <p>
        Preferimos processamento no EEE. Se algum subprocessador tratar dados fora do EEE,
        exigimos salvaguardas adequadas (ex. cláusulas contratuais-tipo).
      </p>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <p>
        This Policy explains how Predz processes personal data under the GDPR and Portuguese
        Law No. 58/2019.
      </p>
      <p>
        <strong>Controller:</strong> the Predz operator. Contact:{" "}
        <a href="mailto:suporte@predz.app">suporte@predz.app</a>.
      </p>
      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Account:</strong> email, display name, avatar (if you use Google OAuth or
          upload one), user ID.
        </li>
        <li>
          <strong>Usage:</strong> tournaments you join, predictions, special bets, roles
          (member/admin), preferences (e.g. theme, language).
        </li>
        <li>
          <strong>Technical:</strong> session and auth data (via Supabase Auth), security
          logs, and, if you accept, aggregated usage metrics (Vercel Analytics / Speed
          Insights).
        </li>
        <li>
          <strong>Communications:</strong> transactional emails (account confirmation,
          password reset) and messages you send to suporte@.
        </li>
      </ul>
      <p>We do not collect payment data. Predz does not process money.</p>
      <h2>2. Purposes and legal bases</h2>
      <ul>
        <li>
          <strong>Service delivery</strong> (contract): account, tournaments, scoring and
          rankings.
        </li>
        <li>
          <strong>Legitimate interest:</strong> security, abuse prevention, product
          improvement, aggregated stats needed to run the service.
        </li>
        <li>
          <strong>Consent:</strong> non-essential analytics (Vercel), when you accept via the
          cookie banner.
        </li>
        <li>
          <strong>Legal obligation:</strong> responding to authorities when required by law.
        </li>
      </ul>
      <h2>3. Minors</h2>
      <p>
        Predz is entertainment with no platform-managed payments or prizes. Minimum account
        age is <strong>13</strong>. If you are 13 to 16, parental guidance is recommended. We
        do not target children under 13.
      </p>
      <h2>4. Cookies</h2>
      <ul>
        <li>
          <strong>Essential:</strong> session, authentication, theme, language and technical
          preferences required for the service.
        </li>
        <li>
          <strong>Optional:</strong> if you choose <strong>«Accept all»</strong> in the
          banner, we enable Vercel Analytics and Speed Insights (aggregated usage and
          performance metrics) to improve the product. You can choose «Essential only» and
          still use Predz without those analytics.
        </li>
      </ul>
      <h2>5. Processors</h2>
      <p>We use providers that process data on our behalf, including:</p>
      <ul>
        <li>
          <strong>Supabase</strong>: auth and database (EU / EEA preferred);
        </li>
        <li>
          <strong>Vercel</strong>: frontend hosting and, with consent, analytics;
        </li>
        <li>
          <strong>Resend</strong>: sending and receiving email (Auth SMTP and support);
        </li>
        <li>
          <strong>Google</strong>: if you choose Google sign-in (OAuth).
        </li>
      </ul>
      <p>
        We also use <strong>API-Football / API-Sports</strong> (and, where applicable, other
        sports data sources) for fixtures, results, squads and stats. Those providers typically
        do <strong>not</strong> receive your account personal data. Sync jobs (e.g. GitHub
        Actions) run on our side with API keys and do not send your email or profile to those
        data services.
      </p>
      <h2>6. Retention</h2>
      <p>
        We keep data while your account is active and as needed to run the service. You may
        request account deletion. Some records may be retained for a limited time for legal or
        security reasons (e.g. abuse logs).
      </p>
      <h2>7. Your GDPR rights</h2>
      <p>
        You may request access, rectification, erasure, restriction, objection, portability
        and withdrawal of consent where applicable. Contact:{" "}
        <a href="mailto:suporte@predz.app">suporte@predz.app</a>. You may also complain to the
        CNPD (
        <a href="https://www.cnpd.pt" target="_blank" rel="noreferrer">
          www.cnpd.pt
        </a>
        ).
      </p>
      <h2>8. Security</h2>
      <p>
        We apply reasonable technical and organisational measures (access control, RLS,
        HTTPS). Report vulnerabilities to the contact above.
      </p>
      <h2>9. International transfers</h2>
      <p>
        We prefer processing in the EEA. If a processor handles data outside the EEA, we
        require appropriate safeguards (e.g. standard contractual clauses).
      </p>
    </>
  );
}
