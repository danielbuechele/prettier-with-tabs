"use strict";

const MODE_BREAK = 1;
const MODE_FLAT = 2;

function fits(next, restCommands, width) {
  let restIdx = restCommands.length;
  const cmds = [next];
  while (width >= 0) {
    if (cmds.length === 0) {
      if (restIdx === 0) {
        return true;
      } else {
        cmds.push(restCommands[restIdx - 1]);

        restIdx--;

        continue;
      }
    }

    const x = cmds.pop();
    const ind = x[0];
    const mode = x[1];
    const doc = x[2];
    const align = x[3];

    if (typeof doc === "string") {
      width -= doc.length;
    } else {
      switch (doc.type) {
        case "concat":
          for (var i = doc.parts.length - 1; i >= 0; i--) {
            cmds.push([ind, mode, doc.parts[i], align]);
          }

          break;
        case "indent":
          cmds.push([ind + doc.n, mode, doc.contents, align]);

          break;
        case "align-spaces":
          cmds.push([ind, mode, doc.contents, align + doc.n]);

          break;
        case "group":
          cmds.push([ind, doc.break ? MODE_BREAK : mode, doc.contents, align]);

          break;
        case "if-break":
          if (mode === MODE_BREAK) {
            if (doc.breakContents) {
              cmds.push([ind, mode, doc.breakContents, align]);
            }
          }
          if (mode === MODE_FLAT) {
            if (doc.flatContents) {
              cmds.push([ind, mode, doc.flatContents, align]);
            }
          }

          break;
        case "line":
          switch (mode) {
            // fallthrough
            case MODE_FLAT:
              if (!doc.hard) {
                if (!doc.soft) {
                  width -= 1;
                }

                break;
              }

            case MODE_BREAK:
              return true;
          }
          break;
      }
    }
  }
  return false;
}

function printDocToString(doc, options) {
  let width = options.printWidth;
  let tabWidth = options.tabWidth;
  let useTabs = options.useTabs;
  let indentStr = useTabs ? "\t" : " ".repeat(tabWidth);
  let newLine = options.newLine || "\n";
  let pos = 0;
  // cmds is basically a stack. We've turned a recursive call into a
  // while loop which is much faster. The while loop below adds new
  // cmds to the array instead of recursively calling `print`.
  let cmds = [[0, MODE_BREAK, doc, 0]];
  let out = [];
  let shouldRemeasure = false;
  let lineSuffix = [];

  while (cmds.length !== 0) {
    const x = cmds.pop();
    const ind = x[0];
    const mode = x[1];
    const doc = x[2];
    const align = x[3];

    if (typeof doc === "string") {
      out.push(doc);

      pos += doc.length;
    } else {
      switch (doc.type) {
        case "concat":
          for (var i = doc.parts.length - 1; i >= 0; i--) {
            cmds.push([ind, mode, doc.parts[i], align]);
          }

          break;
        case "indent":
          cmds.push([ind + doc.n, mode, doc.contents, align]);

          break;
        case "align-spaces":
          let nextAlign = align + (useTabs ? (doc.n ? 1 : 0) : doc.n);
          cmds.push([ind, mode, doc.contents, nextAlign]);

          break;
        case "group":
          switch (mode) {
            // fallthrough
            case MODE_FLAT:
              if (!shouldRemeasure) {
                cmds.push([
                  ind,
                  doc.break ? MODE_BREAK : MODE_FLAT,
                  doc.contents,
                  align
                ]);

                break;
              }

            case MODE_BREAK:
              shouldRemeasure = false;

              const next = [ind, MODE_FLAT, doc.contents, align];
              let rem = width - pos;

              if (!doc.break && fits(next, cmds, rem)) {
                cmds.push(next);
              } else {
                // Expanded states are a rare case where a document
                // can manually provide multiple representations of
                // itself. It provides an array of documents
                // going from the least expanded (most flattened)
                // representation first to the most expanded. If a
                // group has these, we need to manually go through
                // these states and find the first one that fits.
                if (doc.expandedStates) {
                  const mostExpanded = doc.expandedStates[
                    doc.expandedStates.length - 1
                  ];

                  if (doc.break) {
                    cmds.push([ind, MODE_BREAK, mostExpanded, align]);

                    break;
                  } else {
                    for (var i = 1; i < doc.expandedStates.length + 1; i++) {
                      if (i >= doc.expandedStates.length) {
                        cmds.push([ind, MODE_BREAK, mostExpanded, align]);

                        break;
                      } else {
                        const state = doc.expandedStates[i];
                        const cmd = [ind, MODE_FLAT, state, align];

                        if (fits(cmd, cmds, rem)) {
                          cmds.push(cmd);

                          break;
                        }
                      }
                    }
                  }
                } else {
                  cmds.push([ind, MODE_BREAK, doc.contents, align]);
                }
              }

              break;
          }
          break;
        case "if-break":
          if (mode === MODE_BREAK) {
            if (doc.breakContents) {
              cmds.push([ind, mode, doc.breakContents, align]);
            }
          }
          if (mode === MODE_FLAT) {
            if (doc.flatContents) {
              cmds.push([ind, mode, doc.flatContents, align]);
            }
          }

          break;
        case "line-suffix":
          lineSuffix.push([ind, mode, doc.contents, align]);
          break;
        case "line":
          switch (mode) {
            // fallthrough
            case MODE_FLAT:
              if (!doc.hard) {
                if (!doc.soft) {
                  out.push(" ");

                  pos += 1;
                }

                break;
              } else {
                // This line was forced into the output even if we
                // were in flattened mode, so we need to tell the next
                // group that no matter what, it needs to remeasure
                // because the previous measurement didn't accurately
                // capture the entire expression (this is necessary
                // for nested groups)
                shouldRemeasure = true;
              }

            case MODE_BREAK:
              if (lineSuffix.length) {
                cmds.push([ind, mode, doc, align]);
                [].push.apply(cmds, lineSuffix.reverse());
                lineSuffix = [];
                break;
              }

              if (doc.literal) {
                out.push(newLine);
                pos = 0;
              } else {
                if (out.length > 0) {
                  // Trim whitespace at the end of line
                  out[out.length - 1] = out[out.length - 1].replace(
                    /[^\S\n]*$/,
                    ""
                  );
                }

                let lineIndent = useTabs
                  ? indentStr.repeat(ind + align)
                  : indentStr.repeat(ind) + " ".repeat(align);
                out.push(/*lineSuffix +*/ newLine + lineIndent);
                pos = ind * tabWidth + align;
/*
                out.push(newLine + " ".repeat(ind));
                pos = ind;
*/
              }
              break;
          }
          break;
        default:
      }
    }
  }
  return out.join("");
}

module.exports = { printDocToString };
