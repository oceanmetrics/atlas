// analysis/templates.ts -- the `sql/*.sql` twins, as text, in ONE place.
//
// `?raw` rather than a string literal in a .ts file, so the file a reviewer reads (and the file the
// parity harness executes under Node, read straight off disk) is byte-for-byte the file the browser
// runs. A twin that exists twice is not a twin.
//
// Nothing here is in `index.html`'s static import graph: the whole analysis layer is reached only
// through a dynamic `import()` from a lens, like `duckdb` itself (CLAUDE.md's budget rules).
import cell_components from "../../../sql/cell_components.sql?raw";
import cell_model_key from "../../../sql/cell_model_key.sql?raw";
import cell_model_seq from "../../../sql/cell_model_seq.sql?raw";
import cell_value from "../../../sql/cell_value.sql?raw";
import cells_in_study_area from "../../../sql/cells_in_study_area.sql?raw";
import composition from "../../../sql/composition.sql?raw";
import scores_for_cells from "../../../sql/scores_for_cells.sql?raw";
import species_for_cells from "../../../sql/species_for_cells.sql?raw";
import species_for_zone from "../../../sql/species_for_zone.sql?raw";
import species_shares from "../../../sql/species_shares.sql?raw";
import type { Templates } from "./queries";

export const TEMPLATES: Templates = {
  cell_components,
  cell_model_key,
  cell_model_seq,
  cell_value,
  cells_in_study_area,
  composition,
  scores_for_cells,
  species_for_cells,
  species_for_zone,
  species_shares,
};
