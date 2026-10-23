// The lens switch's labels, one per lens this codebase can build (`Lens`, state/types.ts); an instance
// shows the ones its `lenses` name, in that order. scripts/instance.mjs writes the same labels into
// index.html's skeleton switch (tests/shell/lenses.test.ts keeps the two equal).
import type { Lens } from "../lib/state/types";

export const LENS_LABEL: Record<Lens, string> = {
  collection: "Collections",
  scores: "Scores",
  species: "Species",
};
