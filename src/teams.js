// Team colours: bright neon tones that stay apart on a TV and on a cheap phone screen.
// The key is also the i18n key for the colour name (color.<key>).
const TEAM_COLORS = ['amber', 'pink', 'cyan', 'lime', 'violet', 'orange', 'red', 'teal', 'yellow', 'blue', 'mint', 'rose',
  // More colours for a big night: up to 24 teams with a phone each.
  'white', 'silver', 'magenta', 'purple', 'sky', 'indigo', 'green', 'olive', 'peach', 'coral', 'lavender', 'ice'];

// The most teams in one quiz (phone and paper teams together). Once every colour is taken, colours are shared.
const MAX_TEAMS = 40;

module.exports = { TEAM_COLORS, MAX_TEAMS };
