// An error that is safe to show to a person. code: invalid | forbidden | not-found | conflict | quota | auth | setup | network
class TeamError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'TeamError';
    this.code = code;
  }
}

module.exports = { TeamError };
