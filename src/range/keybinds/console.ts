// Source-style console text: commands end at a newline or an unquoted `;`,
// `//` starts a comment and an unterminated quote runs to the end of the line.
// CS2 stores `bind "y" "+voicerecord"";` as `+voicerecord ;`, and so do we.

/** Splits console text into command strings. */
export function splitCommands(text: string): string[] {
  const commands: string[] = [];
  let current = '', quoted = false;
  const push = () => {const command = current.trim(); if (command) commands.push(command); current = '';};
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {quoted = false; push(); continue;}
    if (c === '\r') continue;
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '/' && text[i + 1] === '/') {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
      continue;
    } else if (!quoted && c === ';') {push(); continue;}
    current += c;
  }
  push();
  return commands;
}

/** Splits one command into arguments, removing quotes. */
export function tokenize(command: string): string[] {
  const args: string[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && /\s/.test(command[i])) i++;
    if (i >= command.length) break;
    if (command[i] === '"') {
      const end = command.indexOf('"', i + 1);
      args.push(command.slice(i + 1, end < 0 ? undefined : end));
      i = end < 0 ? command.length : end + 1;
    } else {
      const start = i;
      while (i < command.length && !/\s/.test(command[i]) && command[i] !== '"') i++;
      args.push(command.slice(start, i));
    }
  }
  return args;
}

/** Tokenized commands of a console text. */
export const commandsOf = (text: string) => splitCommands(text).map(tokenize).filter(args => args.length > 0);

/** Writes a value the way a cfg file needs it. CS2 cannot escape quotes, so they are dropped. */
export const quote = (value: string) => `"${value.replace(/"/g, '')}"`;

export type KeyValues = {[key: string]: string | KeyValues};

/** Parses Valve KeyValues text (.vcfg, localization). Later duplicate keys win. */
export function parseKeyValues(text: string): KeyValues {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|(\/\/[^\n]*)|([{}])|([^\s{}"]+)/g;
  for (const match of text.replace(/^\uFEFF/, '').matchAll(pattern)) {
    if (match[2] !== undefined) continue;
    tokens.push(match[1] !== undefined ? `"${match[1]}` : match[3] ?? match[4]);
  }
  let cursor = 0;
  const value = (token: string) => token.startsWith('"') ? token.slice(1).replace(/\\"/g, '"') : token;
  function object(): KeyValues {
    const result: KeyValues = {};
    while (cursor < tokens.length && tokens[cursor] !== '}') {
      const key = value(tokens[cursor++]);
      const next = tokens[cursor++];
      if (next === undefined) break;
      if (next === '{') {result[key] = object(); cursor++;}
      else if (next !== '}') result[key] = value(next);
      else break;
    }
    return result;
  }
  return object();
}
