// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader returns for {text, header}:
// {columns, rows, errors}. The policy (from the competition rules):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled
//     ("" inside it is one quote, each CRLF or lone CR inside it is LF);
//     what follows its closing quote up to the next comma or line break is
//     appended as it stands (quote_junk, when the field ends);
//     a quote that never closes is a literal character and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes, row its record's index in rows (null for the header).
//
// Speed: the reference builds every field one character at a time
// (value += c). This reader never does that on the common path. An unquoted
// field is found with two indexOf calls (comma, LF -- both implemented in
// native code and both stop within the field / record) plus one slice; a
// quoted field with no doubled quote and no line break inside is one
// indexOf for its closing quote plus one slice. Only the rare paths -- a
// stray CR, a "" pair, a line break inside quotes, junk after a closing
// quote, an unterminated quote -- fall back to character work, and only
// over the field that needs it.
//
// Two facts make the indexOf scan exact:
//   - In an unquoted field, any CR before the next comma or LF is stray:
//     a CR followed by LF would make that LF the field's end instead.
//     So stray CRs are counted and stripped from the slice afterwards.
//   - In a quoted field, indexOf('"') finds the closing quote unless a
//     "" pair or a line break sits before it; both are detected with
//     bounded indexOf checks and routed to the slow scan.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const N = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on

  if (N > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Reads unquoted characters from pos onto `prefix` up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr). Returns the
  // field, how it ended, and how many characters were kept (added). Used for
  // junk after a closing quote and for the rescan of an unterminated quote:
  // both are rare, so this may afford the extra work.
  function readUnquoted(prefix, recLine, recRow) {
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    let e;
    let ended;
    if (comma === -1 && lf === -1) {
      e = N;
      ended = END;
    } else if (comma === -1) {
      e = lf;
      ended = BREAK;
    } else if (lf === -1) {
      e = comma;
      ended = COMMA;
    } else if (comma < lf) {
      e = comma;
      ended = COMMA;
    } else {
      e = lf;
      ended = BREAK;
    }
    let seg;
    if (ended === BREAK && e > pos && text.charCodeAt(e - 1) === 13) {
      // CRLF: the CR belongs to the line break, not to the field.
      seg = text.slice(pos, e - 1);
      pos = e + 1;
      line += 1;
    } else {
      seg = text.slice(pos, e);
      if (ended === COMMA) pos = e + 1;
      else if (ended === BREAK) {
        pos = e + 1;
        line += 1;
      } else {
        pos = N;
      }
    }
    let added = seg.length;
    if (seg.indexOf('\r') !== -1) {
      // Every CR left in seg is stray (see the note at the top of the file).
      let k = -1;
      let count = 0;
      while ((k = seg.indexOf('\r', k + 1)) !== -1) count += 1;
      for (let i = 0; i < count; i++) errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      seg = seg.replace(/\r/g, '');
      added = seg.length;
    }
    return { value: prefix + seg, ended, added };
  }

  // Finishes a quoted field whose closing quote is behind pos: comma, line
  // break, end of text, or junk appended as it stands. Pushes the field and
  // returns how it ended.
  function endQuoted(value, fields, recLine, recRow) {
    if (pos >= N) {
      fields.push(value);
      return END;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fields.push(value);
      return COMMA;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fields.push(value);
      return BREAK;
    }
    if (c === 13 && pos + 1 < N && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fields.push(value);
      return BREAK;
    }
    const junk = readUnquoted(value, recLine, recRow);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
    fields.push(junk.value);
    return junk.ended;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < N) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < N && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        quoted = true;
        const open = pos;
        const openLine = line;
        const start = pos + 1;
        const q = text.indexOf('"', start);
        if (q === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          line = openLine;
          pos = open + 1;
          const r = readUnquoted('"', recordLine, recordRow);
          fields.push(r.value);
          ended = r.ended;
        } else {
          const nl = text.indexOf('\n', start);
          const cr = text.indexOf('\r', start);
          const doubled = q + 1 < N && text.charCodeAt(q + 1) === 34;
          if ((nl === -1 || nl >= q) && (cr === -1 || cr >= q) && !doubled) {
            // Fast path: no doubled quote, no line break inside.
            pos = q + 1;
            ended = endQuoted(text.slice(start, q), fields, recordLine, recordRow);
          } else {
            // Slow path: "" pairs and/or line breaks inside the quotes.
            let parts = null;
            let seg = start;
            let i = start;
            let closed = false;
            let value = '';
            while (i < N) {
              const c = text.charCodeAt(i);
              if (c === 34) {
                if (i + 1 < N && text.charCodeAt(i + 1) === 34) {
                  if (parts === null) parts = [];
                  parts.push(text.slice(seg, i), '"');
                  i += 2;
                  seg = i;
                  continue;
                }
                if (parts === null) value = text.slice(seg, i);
                else {
                  parts.push(text.slice(seg, i));
                  value = parts.join('');
                }
                pos = i + 1;
                closed = true;
                break;
              }
              if (c === 13) {
                // CRLF and a lone CR inside quotes are each one LF.
                if (parts === null) parts = [];
                parts.push(text.slice(seg, i), '\n');
                line += 1;
                i += i + 1 < N && text.charCodeAt(i + 1) === 10 ? 2 : 1;
                seg = i;
                continue;
              }
              if (c === 10) line += 1;
              i += 1;
            }
            if (!closed) {
              errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
              line = openLine;
              pos = open + 1;
              const r = readUnquoted('"', recordLine, recordRow);
              fields.push(r.value);
              ended = r.ended;
            } else {
              ended = endQuoted(value, fields, recordLine, recordRow);
            }
          }
        }
      } else {
        // An unquoted field: two indexOf calls and one slice.
        quoted = false;
        const comma = text.indexOf(',', pos);
        const lf = text.indexOf('\n', pos);
        let e;
        let kind;
        if (comma === -1 && lf === -1) {
          e = N;
          kind = END;
        } else if (comma === -1) {
          e = lf;
          kind = BREAK;
        } else if (lf === -1) {
          e = comma;
          kind = COMMA;
        } else if (comma < lf) {
          e = comma;
          kind = COMMA;
        } else {
          e = lf;
          kind = BREAK;
        }
        let value;
        if (kind === BREAK && e > pos && text.charCodeAt(e - 1) === 13) {
          value = text.slice(pos, e - 1);
          pos = e + 1;
          line += 1;
        } else {
          value = text.slice(pos, e);
          if (kind === COMMA) pos = e + 1;
          else if (kind === BREAK) {
            pos = e + 1;
            line += 1;
          } else {
            pos = N;
          }
        }
        if (value.indexOf('\r') !== -1) {
          let k = -1;
          let count = 0;
          while ((k = value.indexOf('\r', k + 1)) !== -1) count += 1;
          for (let i = 0; i < count; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          value = value.replace(/\r/g, '');
        }
        fields.push(value);
        ended = kind;
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
