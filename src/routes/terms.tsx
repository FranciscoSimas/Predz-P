import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Termos de Utilização - Predz" },
      {
        name: "description",
        content:
          "Termos de utilização da Predz: prognósticos entre amigos, sem apostas com dinheiro na plataforma. Contacto: suporte@predz.app.",
      },
      { name: "robots", content: "index,follow,max-snippet:40" },
      { property: "og:title", content: "Termos de Utilização - Predz" },
      { property: "og:url", content: "https://predz.app/terms" },
    ],
    links: [{ rel: "canonical", href: "https://predz.app/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  const { locale, t } = useT();
  const en = locale === "en";

  return (
    <LegalPage title={t.legal.termsTitle} updated={t.legal.termsUpdated}>
      {en ? <TermsEn /> : <TermsPt />}
    </LegalPage>
  );
}

function TermsPt() {
  return (
    <>
      <p>
        Estes Termos regulam o acesso e utilização da Predz (“nós”, “plataforma”), um serviço
        de prognósticos de futebol entre amigos. Ao criares conta ou usares a Predz, aceitas
        estes Termos. Contacto:{" "}
        <a href="mailto:suporte@predz.app">suporte@predz.app</a>.
      </p>
      <h2>1. O que é a Predz</h2>
      <p>
        A Predz permite criar ou entrar em torneios, registar prognósticos sobre jogos de
        futebol e consultar rankings. É um serviço de entretenimento e competição amigável
        baseado em habilidade (acertar resultados), não um serviço de apostas.
      </p>
      <h2>2. Sem dinheiro na plataforma</h2>
      <ul>
        <li>
          A Predz <strong>não processa pagamentos</strong>, entradas, depósitos nem
          levantamentos.
        </li>
        <li>Não vendemos bilhetes de aposta nem atuamos como casa de apostas.</li>
        <li>
          Quaisquer “prémios” ou valores mostrados na app (incluindo totais estimados em
          torneios privados) são <strong>meramente informativos</strong>, configuráveis pelos
          administradores, e qualquer acordo, cobrança ou entrega ocorre{" "}
          <strong>fora da Predz</strong>, entre os participantes.
        </li>
        <li>
          Não somos responsáveis por acordos monetários ou materiais feitos entre
          utilizadores.
        </li>
      </ul>
      <h2>3. Conta e elegibilidade</h2>
      <ul>
        <li>
          Deves ter pelo menos <strong>13 anos</strong> para criares conta. Se tiveres menos
          de 16 anos, recomenda-se o acordo dos teus pais ou responsáveis legais.
        </li>
        <li>
          És responsável pela segurança da tua conta e pela veracidade dos dados que fores.
        </li>
        <li>Não podes partilhar a conta nem tentar aceder a contas de terceiros.</li>
      </ul>
      <h2>4. Conduta</h2>
      <p>Comprometes-te a não:</p>
      <ul>
        <li>Usar a Predz de forma ilegal ou abusiva;</li>
        <li>Manipular pontuações, explorar falhas ou automatizar ações de forma abusiva;</li>
        <li>Assediar outros utilizadores ou publicar conteúdo ofensivo;</li>
        <li>
          Fazer engenharia reversa indevida ou tentar comprometer a segurança do serviço.
        </li>
      </ul>
      <p>Podemos suspender ou eliminar contas que violem estes Termos.</p>
      <h2>5. Torneios e regras</h2>
      <ul>
        <li>
          Cada torneio tem regras configuráveis pelo criador/admin (pontos, wildcards, etc.).
        </li>
        <li>
          Os prognósticos bloqueiam tipicamente no kickoff do jogo (ou conforme regra do
          torneio).
        </li>
        <li>
          Resultados oficiais são sincronizados a partir de fontes de dados de terceiros.
          Podem ocorrer atrasos ou correções.
        </li>
      </ul>
      <h2>6. Propriedade intelectual, dados desportivos e marcas</h2>
      <ul>
        <li>
          A marca Predz, o design e o software pertencem-nos ou aos nossos licenciadores.
        </li>
        <li>
          Nomes, emblemas, escudos, logos e fotos de jogadores de competições e clubes
          pertencem aos respetivos titulares. Na Predz são usados para{" "}
          <strong>identificação</strong> (fair use / uso descritivo), não como endosso.
        </li>
        <li>
          A Predz <strong>não é afiliada</strong> nem endossada pela FIFA, UEFA, ligas,
          federações ou clubes. Não uses a Predz para sugerir parceria oficial com essas
          entidades.
        </li>
        <li>
          Dados de calendário, resultados e estatísticas vêm de fornecedores (ex.
          API-Football). Respeitamos as restrições desses fornecedores e dos titulares de
          direitos das competições.
        </li>
      </ul>
      <h2>7. Disponibilidade e isenção</h2>
      <p>
        O serviço é prestado “tal como está”. Fazemos esforços razoáveis para manter a Predz
        disponível e correta, mas não garantimos ausência de interrupções ou erros. Na medida
        máxima permitida pela lei, não respondemos por danos indiretos decorrentes do uso da
        Predz.
      </p>
      <h2>8. Privacidade</h2>
      <p>
        O tratamento de dados pessoais está descrito na{" "}
        <a href="/privacy">Política de Privacidade</a>.
      </p>
      <h2>9. Alterações</h2>
      <p>
        Podemos atualizar estes Termos. A data no topo indica a versão em vigor. O uso
        continuado após alterações relevantes constitui aceitação, salvo quando a lei exija
        novo consentimento.
      </p>
      <h2>10. Lei aplicável</h2>
      <p>
        Estes Termos regem-se pela lei portuguesa. Em caso de litígio, e sem prejuízo de
        direitos imperativos do consumidor, os tribunais portugueses são competentes.
      </p>
    </>
  );
}

function TermsEn() {
  return (
    <>
      <p>
        These Terms govern access to and use of Predz (“we”, “platform”), a football
        prediction service for friends. By creating an account or using Predz, you accept
        these Terms. Contact:{" "}
        <a href="mailto:suporte@predz.app">suporte@predz.app</a>.
      </p>
      <h2>1. What Predz is</h2>
      <p>
        Predz lets you create or join tournaments, submit predictions on football matches
        and view rankings. It is entertainment and friendly competition based on skill
        (predicting results), not a betting service.
      </p>
      <h2>2. No money on the platform</h2>
      <ul>
        <li>
          Predz <strong>does not process payments</strong>, entry fees, deposits or
          withdrawals.
        </li>
        <li>We do not sell bets or act as a bookmaker.</li>
        <li>
          Any “prizes” or amounts shown in the app (including estimated pots in private
          tournaments) are <strong>informational only</strong>, set by admins, and any
          agreement, collection or delivery happens <strong>outside Predz</strong> among
          participants.
        </li>
        <li>We are not responsible for monetary or material agreements between users.</li>
      </ul>
      <h2>3. Account and eligibility</h2>
      <ul>
        <li>
          You must be at least <strong>13 years old</strong> to create an account. If you are
          under 16, parental or guardian agreement is recommended.
        </li>
        <li>
          You are responsible for account security and the accuracy of the data you provide.
        </li>
        <li>You may not share your account or try to access other people’s accounts.</li>
      </ul>
      <h2>4. Conduct</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use Predz illegally or abusively;</li>
        <li>Manipulate scores, exploit bugs or automate actions abusively;</li>
        <li>Harass other users or post offensive content;</li>
        <li>Improperly reverse-engineer or attempt to compromise the service.</li>
      </ul>
      <p>We may suspend or delete accounts that breach these Terms.</p>
      <h2>5. Tournaments and rules</h2>
      <ul>
        <li>Each tournament has rules set by the creator/admin (points, wildcards, etc.).</li>
        <li>Predictions typically lock at kick-off (or as the tournament rule states).</li>
        <li>
          Official results come from third-party data sources. Delays or corrections may
          occur.
        </li>
      </ul>
      <h2>6. Intellectual property, sports data and brands</h2>
      <ul>
        <li>The Predz brand, design and software belong to us or our licensors.</li>
        <li>
          Competition and club names, crests, logos and player photos belong to their
          respective owners. In Predz they are used for <strong>identification</strong>{" "}
          (fair use / descriptive use), not as endorsement.
        </li>
        <li>
          Predz is <strong>not affiliated</strong> with or endorsed by FIFA, UEFA, leagues,
          federations or clubs. Do not use Predz to imply an official partnership with those
          entities.
        </li>
        <li>
          Fixtures, results and statistics come from providers (e.g. API-Football). We follow
          those providers’ restrictions and the rights holders of competitions.
        </li>
      </ul>
      <h2>7. Availability and disclaimer</h2>
      <p>
        The service is provided “as is”. We make reasonable efforts to keep Predz available
        and accurate, but we do not guarantee uninterrupted service or error-free scoring. To
        the fullest extent permitted by law, we are not liable for indirect damages arising
        from use of Predz.
      </p>
      <h2>8. Privacy</h2>
      <p>
        Personal data processing is described in the{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <h2>9. Changes</h2>
      <p>
        We may update these Terms. The date at the top shows the current version. Continued
        use after material changes constitutes acceptance, unless the law requires fresh
        consent.
      </p>
      <h2>10. Governing law</h2>
      <p>
        These Terms are governed by Portuguese law. Subject to mandatory consumer rights,
        Portuguese courts have jurisdiction.
      </p>
    </>
  );
}
