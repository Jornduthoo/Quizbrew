// Makes the "How to organise a quiz night" guide pages, one static page per language (good for search engines):
// website/quiz-night.html, quizavond.html, soiree-quiz.html, quizabend.html, noche-de-quiz.html.
// The free sample questions come from the app's own sample quiz (quizzes/night-pack-1.<lang>.json).
// Run: node website/tools/guides.js (tools/build.js runs it too, after a new version stamp).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const site = path.join(root, 'website');
const BASE = 'https://quizbrew.app/';
// Same cache-busting stamp as index.html (tools/build.js sets it), so a new stylesheet reaches every page.
const stamp = () => (fs.readFileSync(path.join(site, 'index.html'), 'utf8').match(/\?v=(\d+)/) || [])[1] || '1';

const PAGES = { en: 'quiz-night.html', nl: 'quizavond.html', fr: 'soiree-quiz.html', de: 'quizabend.html', es: 'noche-de-quiz.html' };
const NAMES = { en: 'English', nl: 'Nederlands', fr: 'Français', de: 'Deutsch', es: 'Español' };

const T = {
  en: {
    title: 'How to organise a quiz night: a step-by-step guide',
    desc: 'Plan a quiz night for your club, pub, school or party: format, venue, questions, scoring, raising money and a checklist for the night. With 10 free sample questions.',
    eyebrow: 'Quiz night guide',
    h1: 'How to organise a quiz night',
    intro: 'A good quiz night is mostly planning. This guide takes you from the first idea to the last scoreboard, whether it is for a sports club, a pub, a school, a youth group or a birthday. At the bottom you will find a checklist and 10 free sample questions.',
    steps: [
      ['Pick the date, the venue and the format', [
        'Set the date at least three weeks ahead. Friday and Saturday evenings work best.',
        'Teams of 4 to 6 people feel the most fun. Ask teams to sign up in advance, so you know how many tables you need.',
        'Plan 6 to 8 rounds of 8 to 10 questions. With a break halfway, that is an evening of 2.5 to 3 hours.',
      ]],
      ['Sort out the screen and the sound', [
        'A TV or projector that every table can see, a laptop, an HDMI cable and speakers for the music round.',
        'Test everything in the venue itself, ideally a few days before. A microphone helps from about 15 teams.',
      ], 'With Quizbrew, the laptop makes its own network if the venue has no good wifi. Teams play on their phones, no internet needed.'],
      ['Write questions that everyone enjoys', [
        'Mix topics: general knowledge, music, sport, film, geography, the local area.',
        'Start easy and build up. Every team should know a few answers in every round.',
        'Avoid questions anyone can look up in two seconds, and check every answer twice.',
        'Vary the rounds: a picture round, a music round, a drawing round or a "closest wins" question keeps the room awake.',
      ], 'In Quizbrew you pick a topic and difficulty, and the AI builder writes a full round in a minute. You can still edit every question.'],
      ['Agree the rules and the scoring', [
        'Say clearly whether phones may be used, and how many points each question is worth.',
        'Keep a tiebreaker ready: a "closest wins" number question settles a draw fairly.',
        'Show the standings after every round. That is when the room gets loud.',
      ], 'Quizbrew scores every answer itself, shows the scoreboard with a drumroll, and tells you when a player leaves the quiz page to search.'],
      ['Raise money (for clubs and schools)', [
        'Ask an entry fee of €10 to €20 per team, paid when signing up.',
        'The bar and snacks during the break often bring in more than the entry fees.',
        'Ask local shops for prizes and thank them on the screen between rounds.',
        'A raffle during the break adds extra income and fun.',
      ]],
    ],
    checkH: 'Checklist for the night',
    check: ['Laptop and charger', 'HDMI cable (and an adapter if needed)', 'Extension lead and power strip', 'TV or projector tested in the venue', 'Sound tested for the music round', 'Quiz run through once from start to finish', 'Pens and paper for teams without a phone', 'Prizes, and a prize for the last place', 'Sponsor names on a slide', 'A tiebreaker question'],
    sampleH: '10 free quiz questions',
    sampleP: 'Free to use at your own quiz night. They come from the sample quiz that is included in Quizbrew.',
    ans: 'Answers', tf: ['True', 'False'], closest: 'Closest wins',
    ctaH: 'Run your quiz night with Quizbrew',
    ctaP: 'One laptop runs the night, teams play on their phones. No subscription, no internet in the venue. The free version works for 4 teams.',
    cta: 'Discover Quizbrew',
    home: 'Home', privacy: 'Privacy',
  },
  nl: {
    title: 'Een quizavond organiseren: stappenplan en checklist',
    desc: 'Organiseer een quiz voor je vereniging, jeugdbeweging, school, café of feest: formule, zaal, vragen, punten, geld inzamelen en een checklist. Met 10 gratis quizvragen.',
    eyebrow: 'Gids voor quizmasters',
    h1: 'Hoe organiseer je een quizavond?',
    intro: 'Een geslaagde quiz is vooral goede voorbereiding. Deze gids neemt je mee van het eerste idee tot het laatste scorebord, of het nu voor een sportclub, een jeugdbeweging, een oudercomité, een café of een verjaardag is. Onderaan vind je een checklist en 10 gratis quizvragen.',
    steps: [
      ['Kies de datum, de zaal en de formule', [
        'Leg de datum minstens drie weken op voorhand vast. Vrijdag- en zaterdagavond werken het best.',
        'Ploegen van 4 tot 6 personen zijn het leukst. Laat ploegen vooraf inschrijven, dan weet je hoeveel tafels je nodig hebt.',
        'Reken op 6 tot 8 rondes van 8 tot 10 vragen. Met een pauze halverwege heb je een avond van 2,5 tot 3 uur.',
      ]],
      ['Regel het scherm en het geluid', [
        'Een tv of projector die elke tafel kan zien, een laptop, een HDMI-kabel en boxen voor de muziekronde.',
        'Test alles in de zaal zelf, liefst een paar dagen op voorhand. Vanaf een vijftiental ploegen helpt een micro.',
      ], 'Met Quizbrew maakt de laptop zelf een netwerk als de zaal geen goede wifi heeft. Ploegen spelen mee met hun gsm, zonder internet.'],
      ['Schrijf vragen die iedereen leuk vindt', [
        'Wissel de thema\'s af: algemene kennis, muziek, sport, film, aardrijkskunde, iets over je eigen gemeente.',
        'Begin makkelijk en bouw op. Elke ploeg moet in elke ronde een paar antwoorden weten.',
        'Vermijd vragen die je in twee seconden opzoekt, en controleer elk antwoord twee keer.',
        'Wissel de rondes af: een fotoronde, een muziekronde, een tekenronde of een "wie zit het dichtst"-vraag houdt de zaal wakker.',
      ], 'In Quizbrew kies je een thema en een moeilijkheid, en de AI schrijft een volledige ronde in een minuut. Je kan elke vraag nog aanpassen.'],
      ['Spreek de regels en de punten af', [
        'Zeg duidelijk of gsm\'s mogen, en hoeveel punten elke vraag waard is.',
        'Hou een schiftingsvraag klaar: een getal raden ("wie zit het dichtst") beslist een gelijke stand eerlijk.',
        'Toon de tussenstand na elke ronde. Dan komt er pas echt sfeer in de zaal.',
      ], 'Quizbrew telt alle punten zelf, toont het scorebord met tromgeroffel, en laat je zien wanneer een speler de quiz verlaat om iets op te zoeken.'],
      ['Zamel geld in (voor verenigingen en scholen)', [
        'Vraag €10 tot €20 inschrijvingsgeld per ploeg, te betalen bij het inschrijven.',
        'De bar en een hapje tijdens de pauze brengen vaak meer op dan het inschrijvingsgeld.',
        'Vraag prijzen aan lokale handelaars en bedank ze op het scherm tussen de rondes.',
        'Een tombola tijdens de pauze zorgt voor extra inkomsten en plezier.',
      ]],
    ],
    checkH: 'Checklist voor de avond zelf',
    check: ['Laptop en lader', 'HDMI-kabel (en een adapter als dat nodig is)', 'Verlengkabel en stekkerdoos', 'Tv of projector getest in de zaal', 'Geluid getest voor de muziekronde', 'De quiz één keer volledig doorlopen', 'Balpennen en papier voor ploegen zonder gsm', 'Prijzen, ook een poedelprijs voor de laatste', 'Namen van de sponsors op een dia', 'Een schiftingsvraag'],
    sampleH: '10 gratis quizvragen',
    sampleP: 'Gratis te gebruiken op je eigen quizavond. Ze komen uit de voorbeeldquiz die in Quizbrew zit.',
    ans: 'Antwoorden', tf: ['Waar', 'Niet waar'], closest: 'Wie zit het dichtst?',
    ctaH: 'Speel je quizavond met Quizbrew',
    ctaP: 'Eén laptop draait de avond, ploegen spelen mee met hun gsm. Geen abonnement, geen internet nodig in de zaal. De gratis versie werkt voor 4 ploegen.',
    cta: 'Ontdek Quizbrew',
    home: 'Home', privacy: 'Privacy',
  },
  fr: {
    title: 'Organiser une soirée quiz : le guide étape par étape',
    desc: 'Organise une soirée quiz pour ton club, ton école, ton bar ou une fête : formule, salle, questions, points, récolte de fonds et checklist. Avec 10 questions gratuites.',
    eyebrow: 'Guide du quizmaster',
    h1: 'Comment organiser une soirée quiz ?',
    intro: 'Une soirée quiz réussie, c\'est surtout de la préparation. Ce guide t\'accompagne de la première idée au dernier tableau des scores, pour un club de sport, un mouvement de jeunesse, une école, un bar ou un anniversaire. En bas, tu trouveras une checklist et 10 questions gratuites.',
    steps: [
      ['Choisis la date, la salle et la formule', [
        'Fixe la date au moins trois semaines à l\'avance. Le vendredi et le samedi soir marchent le mieux.',
        'Des équipes de 4 à 6 personnes, c\'est le plus amusant. Fais inscrire les équipes à l\'avance pour savoir combien de tables il faut.',
        'Prévois 6 à 8 manches de 8 à 10 questions. Avec une pause à mi-chemin, cela fait une soirée de 2 h 30 à 3 h.',
      ]],
      ['Prévois l\'écran et le son', [
        'Une télé ou un projecteur visible de chaque table, un ordinateur portable, un câble HDMI et des enceintes pour la manche musicale.',
        'Teste tout dans la salle même, idéalement quelques jours avant. Un micro aide à partir d\'une quinzaine d\'équipes.',
      ], 'Avec Quizbrew, l\'ordinateur crée son propre réseau si la salle n\'a pas de bon wifi. Les équipes jouent sur leur téléphone, sans internet.'],
      ['Écris des questions qui plaisent à tous', [
        'Varie les thèmes : culture générale, musique, sport, cinéma, géographie, la région.',
        'Commence facile et monte en difficulté. Chaque équipe doit connaître quelques réponses par manche.',
        'Évite les questions qu\'on trouve en deux secondes en ligne, et vérifie chaque réponse deux fois.',
        'Varie les manches : images, musique, dessin ou une question « le plus proche gagne » gardent la salle éveillée.',
      ], 'Dans Quizbrew, tu choisis un thème et une difficulté, et l\'IA écrit une manche complète en une minute. Tu peux encore modifier chaque question.'],
      ['Fixe les règles et les points', [
        'Dis clairement si les téléphones sont permis, et combien de points vaut chaque question.',
        'Garde une question de départage : deviner un nombre (« le plus proche gagne ») tranche une égalité.',
        'Montre le classement après chaque manche. C\'est là que l\'ambiance monte.',
      ], 'Quizbrew compte tous les points lui-même, montre le classement avec roulement de tambour, et te signale quand un joueur quitte le quiz pour chercher.'],
      ['Récolte des fonds (clubs et écoles)', [
        'Demande 10 à 20 € d\'inscription par équipe, à payer à l\'inscription.',
        'Le bar et les en-cas pendant la pause rapportent souvent plus que les inscriptions.',
        'Demande des prix aux commerçants du coin et remercie-les à l\'écran entre les manches.',
        'Une tombola pendant la pause apporte des revenus et du plaisir en plus.',
      ]],
    ],
    checkH: 'Checklist pour le soir même',
    check: ['Ordinateur et chargeur', 'Câble HDMI (et un adaptateur si besoin)', 'Rallonge et multiprise', 'Télé ou projecteur testé dans la salle', 'Son testé pour la manche musicale', 'Quiz parcouru une fois en entier', 'Stylos et papier pour les équipes sans téléphone', 'Des prix, et un lot de consolation pour la dernière équipe', 'Noms des sponsors sur une diapo', 'Une question de départage'],
    sampleH: '10 questions de quiz gratuites',
    sampleP: 'Libres d\'utilisation pour ta propre soirée. Elles viennent du quiz d\'exemple inclus dans Quizbrew.',
    ans: 'Réponses', tf: ['Vrai', 'Faux'], closest: 'Le plus proche gagne',
    ctaH: 'Anime ta soirée quiz avec Quizbrew',
    ctaP: 'Un ordinateur fait tourner la soirée, les équipes jouent sur leur téléphone. Pas d\'abonnement, pas d\'internet dans la salle. La version gratuite marche pour 4 équipes.',
    cta: 'Découvrir Quizbrew',
    home: 'Accueil', privacy: 'Confidentialité',
  },
  de: {
    title: 'Einen Quizabend organisieren: Schritt-für-Schritt-Anleitung',
    desc: 'Plane einen Quizabend für Verein, Schule, Kneipe oder Party: Ablauf, Raum, Fragen, Punkte, Spenden sammeln und eine Checkliste. Mit 10 kostenlosen Quizfragen.',
    eyebrow: 'Leitfaden für Quizmaster',
    h1: 'Wie organisiert man einen Quizabend?',
    intro: 'Ein gelungener Quizabend ist vor allem gute Vorbereitung. Dieser Leitfaden führt dich von der ersten Idee bis zum letzten Punktestand, ob für Sportverein, Jugendgruppe, Schule, Kneipe oder Geburtstag. Unten findest du eine Checkliste und 10 kostenlose Quizfragen.',
    steps: [
      ['Wähle Datum, Raum und Ablauf', [
        'Lege das Datum mindestens drei Wochen vorher fest. Freitag- und Samstagabend funktionieren am besten.',
        'Teams mit 4 bis 6 Leuten machen am meisten Spaß. Lass Teams sich vorher anmelden, dann weißt du, wie viele Tische du brauchst.',
        'Plane 6 bis 8 Runden mit je 8 bis 10 Fragen. Mit einer Pause in der Mitte sind das 2,5 bis 3 Stunden.',
      ]],
      ['Kümmere dich um Bildschirm und Ton', [
        'Ein Fernseher oder Beamer, den jeder Tisch sieht, ein Laptop, ein HDMI-Kabel und Lautsprecher für die Musikrunde.',
        'Teste alles im Raum selbst, am besten ein paar Tage vorher. Ab etwa 15 Teams hilft ein Mikrofon.',
      ], 'Mit Quizbrew macht der Laptop sein eigenes Netz, wenn der Raum kein gutes WLAN hat. Die Teams spielen am Handy, ohne Internet.'],
      ['Schreib Fragen, die allen Spaß machen', [
        'Wechsle die Themen: Allgemeinwissen, Musik, Sport, Film, Erdkunde, etwas über deinen Ort.',
        'Fang leicht an und steigere dich. Jedes Team sollte in jeder Runde ein paar Antworten wissen.',
        'Vermeide Fragen, die man in zwei Sekunden googelt, und prüfe jede Antwort zweimal.',
        'Wechsle die Runden: Bilder, Musik, Zeichnen oder eine Schätzfrage halten den Raum wach.',
      ], 'In Quizbrew wählst du Thema und Schwierigkeit, und die KI schreibt eine ganze Runde in einer Minute. Jede Frage kannst du danach noch ändern.'],
      ['Leg Regeln und Punkte fest', [
        'Sag klar, ob Handys erlaubt sind und wie viele Punkte jede Frage zählt.',
        'Halte eine Stechfrage bereit: Eine Zahl schätzen („Am nächsten dran") entscheidet einen Gleichstand fair.',
        'Zeig den Zwischenstand nach jeder Runde. Dann kommt richtig Stimmung auf.',
      ], 'Quizbrew zählt alle Punkte selbst, zeigt den Punktestand mit Trommelwirbel und meldet dir, wenn ein Spieler das Quiz verlässt, um nachzuschauen.'],
      ['Geld sammeln (für Vereine und Schulen)', [
        'Verlange 10 bis 20 € Startgeld pro Team, zu zahlen bei der Anmeldung.',
        'Die Theke und Snacks in der Pause bringen oft mehr als das Startgeld.',
        'Frag Geschäfte vor Ort nach Preisen und bedanke dich zwischen den Runden auf dem Bildschirm.',
        'Eine Tombola in der Pause bringt zusätzliche Einnahmen und Spaß.',
      ]],
    ],
    checkH: 'Checkliste für den Abend',
    check: ['Laptop und Ladegerät', 'HDMI-Kabel (und bei Bedarf ein Adapter)', 'Verlängerungskabel und Steckdosenleiste', 'Fernseher oder Beamer im Raum getestet', 'Ton für die Musikrunde getestet', 'Quiz einmal komplett durchgespielt', 'Stifte und Papier für Teams ohne Handy', 'Preise, auch einen Trostpreis für den letzten Platz', 'Namen der Sponsoren auf einer Folie', 'Eine Stechfrage'],
    sampleH: '10 kostenlose Quizfragen',
    sampleP: 'Frei verwendbar für deinen eigenen Quizabend. Sie stammen aus dem Beispielquiz, das in Quizbrew enthalten ist.',
    ans: 'Antworten', tf: ['Wahr', 'Falsch'], closest: 'Am nächsten dran',
    ctaH: 'Spiel deinen Quizabend mit Quizbrew',
    ctaP: 'Ein Laptop führt durch den Abend, die Teams spielen am Handy. Kein Abo, kein Internet im Raum. Die kostenlose Version läuft für 4 Teams.',
    cta: 'Quizbrew entdecken',
    home: 'Start', privacy: 'Datenschutz',
  },
  es: {
    title: 'Cómo organizar una noche de quiz: guía paso a paso',
    desc: 'Organiza una noche de quiz para tu club, colegio, bar o fiesta: formato, local, preguntas, puntos, recaudar fondos y una lista de control. Con 10 preguntas gratis.',
    eyebrow: 'Guía para presentadores',
    h1: '¿Cómo organizar una noche de quiz?',
    intro: 'Una buena noche de quiz es sobre todo preparación. Esta guía te lleva de la primera idea al último marcador, sea para un club deportivo, un grupo juvenil, un colegio, un bar o un cumpleaños. Abajo encontrarás una lista de control y 10 preguntas gratis.',
    steps: [
      ['Elige la fecha, el local y el formato', [
        'Fija la fecha con al menos tres semanas de antelación. Los viernes y sábados por la noche funcionan mejor.',
        'Los equipos de 4 a 6 personas son los más divertidos. Pide que se inscriban antes, así sabrás cuántas mesas necesitas.',
        'Prepara de 6 a 8 rondas de 8 a 10 preguntas. Con una pausa a mitad, salen de 2,5 a 3 horas.',
      ]],
      ['Prepara la pantalla y el sonido', [
        'Una tele o un proyector que se vea desde cada mesa, un portátil, un cable HDMI y altavoces para la ronda musical.',
        'Pruébalo todo en el propio local, mejor unos días antes. A partir de unos 15 equipos ayuda un micrófono.',
      ], 'Con Quizbrew, el portátil crea su propia red si el local no tiene buen wifi. Los equipos juegan con el móvil, sin internet.'],
      ['Escribe preguntas que gusten a todos', [
        'Mezcla temas: cultura general, música, deporte, cine, geografía, algo de tu pueblo o barrio.',
        'Empieza fácil y sube la dificultad. Cada equipo debería saber algunas respuestas en cada ronda.',
        'Evita preguntas que se buscan en dos segundos, y comprueba cada respuesta dos veces.',
        'Varía las rondas: imágenes, música, dibujo o una pregunta de «el más cercano gana» mantienen la sala despierta.',
      ], 'En Quizbrew eliges un tema y una dificultad, y la IA escribe una ronda completa en un minuto. Luego puedes editar cada pregunta.'],
      ['Acuerda las reglas y los puntos', [
        'Di claramente si se pueden usar móviles y cuántos puntos vale cada pregunta.',
        'Ten lista una pregunta de desempate: adivinar un número («el más cercano gana») resuelve un empate con justicia.',
        'Muestra la clasificación tras cada ronda. Ahí es cuando la sala se anima.',
      ], 'Quizbrew cuenta todos los puntos solo, muestra la clasificación con redoble de tambor y te avisa cuando un jugador sale del quiz para buscar.'],
      ['Recauda fondos (clubs y colegios)', [
        'Pide de 10 a 20 € de inscripción por equipo, a pagar al inscribirse.',
        'La barra y algo de picar en la pausa suelen dar más que las inscripciones.',
        'Pide premios a los comercios del barrio y agradéceselo en la pantalla entre rondas.',
        'Una rifa en la pausa trae ingresos extra y diversión.',
      ]],
    ],
    checkH: 'Lista de control para la noche',
    check: ['Portátil y cargador', 'Cable HDMI (y un adaptador si hace falta)', 'Alargador y regleta', 'Tele o proyector probado en el local', 'Sonido probado para la ronda musical', 'Quiz repasado una vez de principio a fin', 'Bolígrafos y papel para equipos sin móvil', 'Premios, también uno de consolación para el último', 'Nombres de los patrocinadores en una diapositiva', 'Una pregunta de desempate'],
    sampleH: '10 preguntas de quiz gratis',
    sampleP: 'Libres para usar en tu propia noche de quiz. Vienen del quiz de ejemplo que trae Quizbrew.',
    ans: 'Respuestas', tf: ['Verdadero', 'Falso'], closest: 'El más cercano gana',
    ctaH: 'Presenta tu noche de quiz con Quizbrew',
    ctaP: 'Un portátil lleva la noche, los equipos juegan con el móvil. Sin suscripción, sin internet en el local. La versión gratis funciona para 4 equipos.',
    cta: 'Descubre Quizbrew',
    home: 'Inicio', privacy: 'Privacidad',
  },
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n, lang) => new Intl.NumberFormat({ en: 'en-GB', nl: 'nl-BE', fr: 'fr-BE', de: 'de-DE', es: 'es-ES' }[lang]).format(n);

// 6 multiple choice, 2 true or false, 2 "closest wins" from the sample quiz in that language.
function questions(lang) {
  const quiz = JSON.parse(fs.readFileSync(path.join(root, 'quizzes', `night-pack-1.${lang}.json`), 'utf8'));
  const round = type => quiz.rounds.find(r => r.type === type).questions;
  const t = T[lang];
  return [
    ...round('classic').slice(0, 6).map(q => ({ q: q.question, opts: q.answers, a: q.answers[q.correct] })),
    ...round('trueFalse').slice(0, 2).map(q => ({ q: q.question, opts: t.tf, a: t.tf[q.correct ? 0 : 1] })),
    ...round('closest').slice(0, 2).map(q => ({ q: q.question, tag: t.closest, a: num(q.answer, lang) })),
  ];
}

function page(lang) {
  const t = T[lang], qs = questions(lang), url = BASE + PAGES[lang];
  const alt = Object.entries(PAGES).map(([l, f]) => `<link rel="alternate" hreflang="${l}" href="${BASE}${f}">`).join('\n');
  const steps = t.steps.map(([h, items, tip], i) => `
    <section class="step">
      <h2><span class="n">${i + 1}</span>${esc(h)}</h2>
      <ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${tip ? `
      <p class="qb-tip">${esc(tip)}</p>` : ''}
    </section>`).join('');
  const json = {
    '@context': 'https://schema.org', '@type': 'HowTo', name: t.h1, description: t.desc, inLanguage: lang,
    step: t.steps.map(([h, items], i) => ({ '@type': 'HowToStep', position: i + 1, name: h, text: items.join(' ') })),
  };
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)} · Quizbrew</title>
<meta name="description" content="${esc(t.desc)}">
<meta property="og:title" content="${esc(t.title)}">
<meta property="og:description" content="${esc(t.desc)}">
<meta property="og:image" content="${BASE}video/share.jpg">
<meta property="og:url" content="${url}">
<link rel="canonical" href="${url}">
${alt}
<link rel="alternate" hreflang="x-default" href="${BASE}${PAGES.en}">
<meta name="theme-color" content="#1a0e08">
<link rel="icon" href="img/favicon.png">
<link rel="stylesheet" href="css/site.css?v=${stamp()}">
<link rel="stylesheet" href="css/guide.css?v=${stamp()}">
<script type="application/ld+json">${JSON.stringify(json)}</script>
</head>
<body>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/?lang=${lang}"><img src="img/logo.webp" alt="Quizbrew" width="132" height="60"></a>
    <nav class="guide-langs" aria-label="Language">${Object.entries(PAGES).map(([l, f]) => `<a href="${f}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${l.toUpperCase()}</a>`).join('')}</nav>
  </div>
</header>
<main class="guide">
  <div class="wrap narrow">
    <p class="eyebrow">${esc(t.eyebrow)}</p>
    <h1 class="neon">${esc(t.h1)}</h1>
    <p class="lead">${esc(t.intro)}</p>
${steps}
    <section class="step check">
      <h2>${esc(t.checkH)}</h2>
      <ul class="boxes">${t.check.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    </section>
    <section class="step sample" id="questions">
      <h2>${esc(t.sampleH)}</h2>
      <p>${esc(t.sampleP)}</p>
      <ol class="qs">${qs.map(q => `
        <li><b>${esc(q.q)}</b>${q.opts ? ` <span class="opts">${q.opts.map(esc).join(' · ')}</span>` : ` <span class="opts">${esc(q.tag)}</span>`}</li>`).join('')}
      </ol>
      <details class="answers"><summary>${esc(t.ans)}</summary>
        <ol>${qs.map(q => `<li>${esc(q.a)}</li>`).join('')}</ol>
      </details>
    </section>
    <section class="cta-box">
      <h2>${esc(t.ctaH)}</h2>
      <p>${esc(t.ctaP)}</p>
      <a class="btn brass" href="/?lang=${lang}">${esc(t.cta)}</a>
    </section>
  </div>
</main>
<footer class="foot">
  <div class="wrap foot-in">
    <img src="img/logo.webp" alt="Quizbrew" width="110" height="50" loading="lazy">
    <p><a href="/?lang=${lang}">${esc(t.home)}</a></p>
    <p><a href="privacy.html">${esc(t.privacy)}</a></p>
    <p>${Object.entries(PAGES).filter(([l]) => l !== lang).map(([l, f]) => `<a href="${f}" lang="${l}">${NAMES[l]}</a>`).join(' · ')}</p>
    <p class="copy">© 2026 Quizbrew</p>
  </div>
</footer>
</body>
</html>
`;
}

function writeAll() {
  for (const lang of Object.keys(PAGES)) {
    fs.writeFileSync(path.join(site, PAGES[lang]), page(lang));
    console.log('wrote website/' + PAGES[lang]);
  }
}
if (require.main === module) writeAll();
module.exports = { PAGES, T, page, writeAll };
