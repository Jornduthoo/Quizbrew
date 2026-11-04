// A quiz with the longest texts a quizmaster (or an AI) is likely to write, used by the layout test.
// Every round type that puts text on the big screen is in here, with long titles, long answers and long facts.
const fact = 'A badminton shuttle can reach speeds above 400 km/h during a very hard smash in a professional match.';

module.exports = {
  title: 'Stress test: the longest quiz night titles in the whole wide world',
  language: 'nl',
  rounds: [
    { type: 'classic', title: 'Ronde 2: Van Pretpark tot Popcultuur', questions: [
      { question: 'Welke Belgische stripfiguur reisde in een van zijn avonturen naar de maan, nog voor de echte maanlanding plaatsvond?', answers: ['Kuifje met zijn hond Bobbie en kapitein Haddock', 'Suske en Wiske samen met Lambik en Jerom', 'Robbedoes en Kwabbernoot met de Marsupilami', 'Lucky Luke en Jolly Jumper in het wilde westen'], correct: 0, fact },
    ] },
    { type: 'trueFalse', title: 'Waar of niet waar: de allergrootste onzin over Wetenschapsgeschiedenis', questions: [
      { question: 'Een dag op Venus duurt langer dan een jaar op Venus, omdat de planeet heel traag om haar eigen as draait.', correct: true, fact },
    ] },
    { type: 'open', title: 'Openvragen', questions: [
      { question: 'Welk beroemd bouwwerk in Parijs werd gebouwd voor de wereldtentoonstelling van 1889?', answer: 'Eiffeltoren', accept: ['Tour Eiffel'], fact },
    ] },
    { type: 'closest', title: 'Wie zit er het dichtst bij', questions: [
      { question: 'Hoeveel treden telt de trap van de grond tot de top van de Eiffeltoren in Parijs?', answer: 1665, unit: 'treden', fact },
    ] },
    { type: 'scramble', title: 'Woordmix', questions: [
      { answer: 'POTTER', question: 'Beroemdste tovenaarsleerling ter wereld met een bliksemlitteken op zijn voorhoofd', fact },
    ] },
    { type: 'commonThread', title: 'Wat is de link?', questions: [
      { clues: ['Het is een boyband die in 1993 werd gevormd door producer Lou Pearlman in Orlando, Florida.', 'Ze braken eerst stormachtig door in Europa voordat Amerika volgde.', "Hun megahit begint met de zin 'You are my fire, the one desire'.", 'De band bestaat uit AJ, Howie, Nick, Kevin en Brian.'], answer: 'Backstreet Boys', accept: ['The Backstreet Boys'], fact },
    ] },
    { type: 'pairUp', title: 'Koppel de sport', questions: [
      { question: 'Koppel de sport aan de juiste speelbal of uitrusting die erbij hoort', pairs: [['Voetbal', 'Lederen bal'], ['Tennis', 'Gele viltbal'], ['Badminton', 'Shuttle met veertjes'], ['IJshockey', 'Zwarte rubberen puck'], ['Golf', 'Witte bal met putjes']], fact },
    ] },
    { type: 'orderUp', title: 'In de juiste volgorde', questions: [
      { question: 'Zet deze gebouwen in volgorde van oud naar nieuw, het oudste bovenaan', items: ['De piramides van Gizeh in Egypte', 'Het Colosseum in het oude Rome', 'De Eiffeltoren in Parijs', 'De Burj Khalifa in Dubai', 'Het Atomium in Brussel'], fact },
    ] },
    { type: 'emoji', title: 'Emoji-raadsel', questions: [
      { emoji: '🌧️🐱🐶☂️🏠', question: 'Welk spreekwoord of gezegde zoeken we hier eigenlijk?', answer: 'Het regent pijpenstelen en kattenjongen', fact },
    ] },
    { type: 'listRush', title: 'Lijstjesrace', questions: [
      { question: 'Noem zoveel mogelijk landen die grenzen aan Duitsland', items: ['Nederland', 'België', 'Luxemburg', 'Frankrijk', 'Zwitserland', 'Oostenrijk', 'Tsjechië', 'Polen', 'Denemarken'], fact },
    ] },
    { type: 'wordWeb', title: 'Woordweb: zoek de verbanden', questions: [
      { question: 'Zoek de vier groepjes van vier en wat hen verbindt', groups: [
        { link: 'Rivieren in Europa', words: ['Donau', 'Schelde', 'Theems', 'Wolga'] },
        { link: 'Planeten', words: ['Mercurius', 'Saturnus', 'Jupiter', 'Neptunus'] },
        { link: 'Chocoladerepen', words: ['Bounty', 'Twix', 'Snickers', 'Galaxy'] },
        { link: 'Dansstijlen', words: ['Wals', 'Tango', 'Samba', 'Foxtrot'] },
      ], fact },
    ] },
    { type: 'clueLadder', title: 'Wie ben ik?', questions: [
      { clues: ['Ik ben geboren in een klein dorp aan de rand van een groot bos in het jaar 1853.', 'Ik heb in mijn leven maar één schilderij verkocht, terwijl ik er honderden maakte.', 'Ik woonde een tijd in de Borinage, waar ik voor de mijnwerkers preekte.', 'Mijn bekendste werk toont gele bloemen in een vaas.', 'Ik sneed een stuk van mijn eigen oor af.'], answer: 'Vincent van Gogh', accept: ['Van Gogh'], fact },
    ] },
    { type: 'fiveFacts', title: 'Vijf weetjes', questions: [
      { question: 'Noem de vijf grootste oceanen en zeeën van de wereld', items: ['Stille Oceaan', 'Atlantische Oceaan', 'Indische Oceaan', 'Zuidelijke Oceaan', 'Noordelijke IJszee'], fact },
    ] },
    { type: 'jackpot', title: 'De pot', questions: [
      { category: 'Ruimtevaart en sterrenkunde in de twintigste eeuw', question: 'Wat is de naam van de grootste vulkaan in ons zonnestelsel?', answer: 'Olympus Mons', accept: ['Olympus'], points: 5, fact },
    ] },
    { type: 'speed', title: 'Snelle vingers', questions: [
      { question: 'Hoeveel zijden heeft een zeshoek?', answers: ['Vijf', 'Zes', 'Zeven', 'Acht'], correct: 1, fact },
    ] },
  ],
};

const img = '/img/look/pub-lobby.webp';
const long4 = ['Kuifje met zijn hond Bobbie en kapitein Haddock', 'Suske en Wiske samen met Lambik en Jerom', 'Robbedoes en Kwabbernoot met de Marsupilami', 'Lucky Luke en Jolly Jumper in het wilde westen'];
const mc = (question, extraFields = {}) => ({ question, answers: long4, correct: 0, fact, ...extraFields });
const open = (question, extraFields = {}) => ({ question, answer: 'Eiffeltoren in Parijs', accept: ['Eiffeltoren'], fact, ...extraFields });

// The other round types: pictures, speed and strategy, party rounds with a vote, clocks and finales.
module.exports.more = {
  title: 'Stress test, part two: every other round type with the longest texts',
  language: 'nl',
  rounds: [
    { type: 'picture', title: 'Fotoronde: wat zie je op deze prachtige foto van de kroeg?', questions: [mc('Welke stripfiguur hangt hier aan de muur van het café, links naast de tap?', { image: img })] },
    { type: 'oddOneOut', title: 'Wie hoort er niet bij?', questions: [{ question: 'Welke foto hoort er niet bij het rijtje van de andere drie?', images: [img, img, img, img], captions: ['Een heel lange onderschrift bij de eerste foto', 'Tweede', 'Derde foto met wat meer tekst', 'Vierde'], correct: 2, fact }] },
    { type: 'mapDrop', title: 'Prik op de kaart', questions: [{ question: 'Waar ligt de allerkleinste hoofdstad van Europa op deze kaart?', image: img, spot: { x: 0.4, y: 0.6 }, answer: 'Vaticaanstad', fact }] },
    { type: 'buzzer', title: 'Drukknop', questions: [open('Welk gebouw in Parijs werd gebouwd voor de wereldtentoonstelling van 1889 en was toen het hoogste ter wereld?')] },
    { type: 'lastStanding', title: 'Wie blijft er over?', questions: [mc('Welke Belgische stripfiguur reisde naar de maan, nog voor de echte maanlanding plaatsvond?')] },
    { type: 'pushYourLuck', title: 'Waag je kans', questions: [mc('Welke Belgische stripfiguur reisde naar de maan, nog voor de echte maanlanding plaatsvond?')] },
    { type: 'steal', title: 'Steel de punten', questions: [open('Welk gebouw in Parijs werd gebouwd voor de wereldtentoonstelling van 1889?')] },
    { type: 'pickYourLevel', title: 'Kies je niveau', questions: [{ category: 'Strips en tekenfilms uit de lage landen', levels: [mc('Makkelijk: wie is de hond van Kuifje?'), mc('Gemiddeld: welke stripfiguur reisde naar de maan voor de echte maanlanding?'), mc('Moeilijk: in welk jaar verscheen het eerste album met deze stripheld in het Nederlands?')], fact }] },
    { type: 'hotStreak', title: 'Op dreef', questions: [mc('Welke Belgische stripfiguur reisde naar de maan, nog voor de echte maanlanding plaatsvond?')] },
    { type: 'crowdMind', title: 'Wat zegt de massa?', questions: [{ question: 'Noem iets dat de meeste mensen altijd vergeten mee te nemen als ze op vakantie vertrekken', fact }] },
    { type: 'captionThis', title: 'Bedenk een onderschrift', questions: [{ question: 'Schrijf het grappigste onderschrift bij deze foto van een volle kroeg op vrijdagavond', image: img, fact }] },
    { type: 'bluffBank', title: 'Bluf', questions: [open('Hoe heette het eerste dier dat levend terugkeerde uit de ruimte na een reis rond de aarde?')] },
    { type: 'whosWho', title: 'Wie is wie?', questions: [{ question: 'Onze allerslechtste vakantie ooit was die keer dat we met de hele familie naar ...', fact }] },
    { type: 'stakeIt', title: 'Zet in', questions: [{ category: 'Ruimtevaart en sterrenkunde in de twintigste eeuw', ...mc('Welke Belgische stripfiguur reisde naar de maan, nog voor de echte maanlanding plaatsvond?') }] },
    { type: 'localLegend', title: 'Lokale legende', questions: [open('Hoe heet de oudste kroeg van ons dorp, die al sinds 1750 op dezelfde plek staat?')] },
    { type: 'opponentsPick', title: 'Kies voor de anderen', questions: [{ options: [{ category: 'Strips en tekenfilms uit de lage landen', ...mc('Welke stripfiguur reisde naar de maan?') }, { category: 'Sport', ...mc('Wie won de Ronde van Vlaanderen het vaakst?') }, { category: 'Muziek uit de jaren negentig', ...mc('Welke boyband zong I Want It That Way?') }], fact }] },
    { type: 'headToHead', title: 'Kop aan kop', questions: [mc('Welke Belgische stripfiguur reisde naar de maan, nog voor de echte maanlanding plaatsvond?')] },
    { type: 'clockBank', title: 'Tijdbank', questions: [open('Noem de hoofdstad van Australië, die vaak verward wordt met Sydney of Melbourne'), open('Welk gebouw in Parijs werd gebouwd voor de wereldtentoonstelling van 1889?')] },
  ],
};

// Part three: the round types with sound, video, effects on a picture, drawings and photos from the phones,
// acting and the clock duel. The layout test fills in MEDIA (a sound file, a clip and a drawing it uploads first).
module.exports.media = media => ({
  title: 'Stress test, part three: sound, video, drawings, photos and the clock duel',
  language: 'nl',
  rounds: [
    { type: 'zoomOut', title: 'Inzoomen: wat zie je als we heel langzaam uitzoomen op de foto?', questions: [open('Wat zie je op deze foto die heel langzaam uitzoomt van een klein detail naar het geheel?', { image: img })] },
    { type: 'pixelFog', title: 'Pixelmist', questions: [mc('Wat wordt er langzaam scherp op deze korrelige foto van de kroeg?', { image: img })] },
    { type: 'silhouette', title: 'Schaduwbeeld', questions: [open('Wiens schaduw zie je hier op de muur van het café?', { image: img })] },
    { type: 'music', title: 'Muziekronde: wie zingt dit wereldberoemde nummer uit de jaren tachtig?', questions: [mc('Wie zingt dit nummer dat in 1984 wekenlang op nummer een stond?', { audio: media.audio })] },
    { type: 'introSprint', title: 'Introsprint', questions: [open('Welk nummer hoor je hier, het intro wordt steeds een beetje langer?', { audio: media.audio })] },
    { type: 'rewind', title: 'Achterstevoren', questions: [open('Dit nummer speelt achterstevoren. Welk nummer is het?', { audio: media.audio })] },
    { type: 'soundCheck', title: 'Welk geluid is dit?', questions: [mc('Wat maakt dit geluid dat je elke ochtend in de keuken van het café hoort?', { audio: media.audio })] },
    { type: 'lyricGap', title: 'Vul de songtekst aan', questions: [open('Vul het ontbrekende woord in: "Ik heb een ___ voor jou, en het is helemaal van mij alleen"')] },
    { type: 'clipRecall', title: 'Wat heb je gezien in het filmpje?', questions: [{ question: 'Noem zoveel mogelijk dingen die je in het filmpje hebt gezien, hoe meer hoe beter', video: media.video, items: ['Een rode fiets met een mand', 'Hond', 'Paraplu', 'Bakkerij', 'Verkeerslicht', 'Duif'], fact }] },
    { type: 'drawGuess', title: 'Tekenronde: teken het zo snel en zo mooi als je kan', questions: [{ question: 'Teken een kat die op een fiets door de regen naar de kroeg rijdt', fact }] },
    { type: 'photoHunt', title: 'Fotojacht', questions: [{ question: 'Maak een foto van je hele team dat een menselijke piramide bouwt naast de tap', fact }] },
    { type: 'actItOut', title: 'Uitbeelden zonder woorden', questions: [{ answer: 'Tanden poetsen terwijl je op een eenwieler rijdt', accept: ['tanden poetsen'], fact }] },
    { type: 'clockDuel', title: 'Klokduel', questions: [open('Wat is het kleinste priemgetal?'), open('Hoeveel poten heeft een spin?'), open('Welke kleur krijg je als je blauw en geel mengt?')] },
  ],
});
