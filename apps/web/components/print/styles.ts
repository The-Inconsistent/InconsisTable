import { StyleSheet } from "@react-pdf/renderer";

import { INK, PT } from "@/lib/print/constants";

import { FACE } from "./fonts";

// Ink on white, nothing under 9 pt: what every printed page shares.
export const s = StyleSheet.create({
  page: { fontFamily: FACE, fontSize: PT.body, color: INK.text, padding: "10mm 12mm 15mm" },
  title: { fontSize: PT.title, fontWeight: 700, marginBottom: "2mm" },
  head: {
    fontSize: PT.head,
    fontWeight: 700,
    textTransform: "uppercase",
    borderBottomWidth: 1,
    borderBottomColor: INK.line,
    paddingBottom: "0.8mm",
    marginTop: "2mm",
    marginBottom: "2mm",
  },
  label: { fontSize: PT.small, fontWeight: 700, textTransform: "uppercase" },
  small: { fontSize: PT.small },
  bold: { fontWeight: 700 },
  row: { flexDirection: "row", flexWrap: "wrap" },
  box: { borderWidth: 0.8, borderColor: INK.line, padding: "1.2mm", marginRight: "2mm", marginBottom: "1.5mm" },
  ruled: { borderBottomWidth: 0.5, borderBottomColor: INK.faint, height: "6mm" },
  foot: {
    position: "absolute",
    bottom: "7mm",
    left: "12mm",
    right: "12mm",
    fontSize: PT.small,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
