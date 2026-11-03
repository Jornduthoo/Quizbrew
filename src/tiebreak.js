// Tie-break questions: when teams share a place on the podium at the end, one "closest number" question decides.
// The quiz may bring its own ({ question, answer, unit }); otherwise one of these, in the language of the evening.
// The texts are in lang/*.json under tiebreak.q1 ... tiebreak.q8; the answers are here.
const ANSWERS = [330, 1969, 40075, 206, 1989, 88, 384400, 1912];

// The question to play: the quiz's own, or a built-in one (dict = the dictionary of the evening's language).
function question(quiz, dict, pick = Math.random) {
  const own = quiz && quiz.tiebreak;
  if (own && typeof own.question === 'string' && own.question.trim() && Number.isFinite(Number(own.answer))) {
    return { question: own.question.trim().slice(0, 240), answer: Number(own.answer), unit: typeof own.unit === 'string' ? own.unit.slice(0, 20) : '', time: 30, points: 0 };
  }
  const i = Math.floor(pick() * ANSWERS.length) % ANSWERS.length;
  return { question: dict[`tiebreak.q${i + 1}`], answer: ANSWERS[i], unit: '', time: 30, points: 0 };
}

// The teams that share a place in the top three: [[idA, idB], ...] from a ranking.
function podiumTies(ranking) {
  const groups = new Map();
  for (const r of ranking) if (r.rank <= 3) groups.set(r.rank, [...(groups.get(r.rank) || []), r.id]);
  return [...groups.values()].filter(g => g.length > 1);
}

module.exports = { ANSWERS, question, podiumTies };
