// Entry of catalog.html: mounts the catalog page. Its own Vite entry, so none of the map's code
// (MapLibre, the lenses, DuckDB) is on this page's path, and the map entry's size budget is untouched.
import { mount } from "svelte";
import Catalog from "./catalog/Catalog.svelte";
import "./catalog/catalog.css";

const target = document.getElementById("catalog");
if (target) mount(Catalog, { target });
