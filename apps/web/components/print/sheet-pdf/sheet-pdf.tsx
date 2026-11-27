import { Document, Page, pdf, Text, View } from "@react-pdf/renderer";

import { INK, PT, type Paper } from "@/lib/print/constants";
import type { PrintBlock, PrintCell, PrintedSheet } from "@/lib/print/sheet";

import { s } from "../styles";

// The blocks that sit beside each other on the paper; the others take a line of their own.
const INLINE: ReadonlySet<PrintBlock["kind"]> = new Set(["boxes", "pips"]);

type SheetPdfProps = { sheets: PrintedSheet[]; paper: Paper; title: string };

// A column's share of a table's width: wider for the longer texts it holds, so a weapon's rules get room.
const shares = (rows: string[][]) =>
  (rows[0] ?? []).map((_, i) => Math.min(4, Math.max(1, Math.max(...rows.map((r) => (r[i] ?? "").length)) / 8)));

function Cell({ cell }: { cell: PrintCell }) {
  return (
    <View style={{ ...s.box, minWidth: "40mm" }} wrap={false}>
      <Text style={s.label}>{cell.label}</Text>
      {cell.pencil ? (
        <View style={{ height: "7mm", flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end" }}>
          {cell.max !== null && <Text style={s.small}>/ {cell.max}</Text>}
        </View>
      ) : (
        <Text style={{ fontSize: PT.value, fontWeight: 700 }}>{cell.value}</Text>
      )}
      {cell.cite && <Text style={s.small}>{cell.cite}</Text>}
    </View>
  );
}

// One block as paper draws it: a track's boxes, pips, rows, a list, or text with ruled lines under it. Value boxes
// (`cells`) are laid out by the section, so they flow beside the boxes before them.
function Block({ block }: { block: Exclude<PrintBlock, { kind: "cells" }> }) {
  const label = block.label ? <Text style={{ ...s.label, marginBottom: "1mm" }}>{block.label}</Text> : null;
  switch (block.kind) {
    case "boxes":
      return (
        <View wrap={false} style={{ marginBottom: "2mm" }}>
          {label}
          <View style={s.row}>
            {Array.from({ length: block.boxes }, (_, i) => (
              <View
                key={i}
                style={{ width: "6mm", height: "6mm", borderWidth: 0.8, borderColor: INK.line, margin: "0 1mm 1mm 0" }}
              />
            ))}
          </View>
          {block.cite && <Text style={s.small}>{block.cite}</Text>}
        </View>
      );
    case "pips":
      return (
        <View wrap={false} style={{ marginBottom: "2mm" }}>
          {label}
          {block.steps.map((step, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: "1mm" }}>
              <Text style={{ ...s.small, width: "30mm" }}>{step.label}</Text>
              {Array.from({ length: step.size }, (_, j) => (
                <View
                  key={j}
                  style={{
                    width: "4.5mm",
                    height: "4.5mm",
                    borderRadius: "2.25mm",
                    borderWidth: 0.8,
                    borderColor: INK.line,
                    marginRight: "1mm",
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      );
    case "table": {
      const flex = shares([block.head, ...block.rows]);
      const line = (cells: string[], head: boolean, key: number) => (
        <View
          key={key}
          wrap={false}
          style={{
            flexDirection: "row",
            borderBottomWidth: head ? 0.8 : 0.4,
            borderBottomColor: head ? INK.line : INK.faint,
            paddingVertical: "0.8mm",
          }}
        >
          {cells.map((c, i) => (
            <Text key={i} style={{ flex: flex[i] ?? 1, paddingRight: "1.5mm", ...(head ? s.label : {}) }}>
              {c}
            </Text>
          ))}
        </View>
      );
      return (
        <View style={{ marginBottom: "2mm" }}>
          {label}
          {line(block.head, true, -1)}
          {block.rows.map((r, i) => line(r, false, i))}
        </View>
      );
    }
    case "list":
      return (
        <View style={{ marginBottom: "2mm" }}>
          {label}
          {block.items.map((item, i) => (
            <View key={i} wrap={false} style={{ marginBottom: "1.2mm" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.bold}>{item.name}</Text>
                {item.cite && <Text style={s.small}>{item.cite}</Text>}
              </View>
              {item.detail && <Text style={s.small}>{item.detail}</Text>}
            </View>
          ))}
        </View>
      );
    case "text":
      return (
        <View style={{ marginBottom: "2mm" }}>
          {label}
          {block.text !== "" && <Text>{block.text}</Text>}
          {Array.from({ length: block.lines }, (_, i) => (
            <View key={i} style={s.ruled} />
          ))}
        </View>
      );
  }
}

// Character sheets (issue #4): each character from a new page, its layout's sections in order, the footer naming it.
export function SheetPdf({ sheets, paper, title }: SheetPdfProps) {
  return (
    <Document title={title} creator="InconsisTable">
      {sheets.map((sheet, i) => (
        <Page key={i} size={paper} style={s.page}>
          <Text style={s.title}>{sheet.name}</Text>
          {sheet.sections.map((section, j) => (
            <View key={j}>
              <Text style={s.head} minPresenceAhead={80}>
                {section.title}
              </Text>
              {/* Boxes sit side by side and wrap; a table, a list or text takes the full width. */}
              <View style={{ ...s.row, alignItems: "flex-start" }}>
                {section.blocks.flatMap((b, k) =>
                  b.kind === "cells"
                    ? [
                        ...(b.label
                          ? [
                              <Text key={`${k}`} style={{ ...s.label, width: "100%" }}>
                                {b.label}
                              </Text>,
                            ]
                          : []),
                        ...b.cells.map((c, i) => <Cell key={`${k}-${i}`} cell={c} />),
                      ]
                    : [
                        <View key={`${k}`} style={INLINE.has(b.kind) ? { marginRight: "2mm" } : { width: "100%" }}>
                          <Block block={b} />
                        </View>,
                      ],
                )}
              </View>
            </View>
          ))}
          <View style={s.foot} fixed>
            <Text>{sheet.name}</Text>
            <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ))}
    </Document>
  );
}

export const sheetsPdf = (props: SheetPdfProps) => pdf(<SheetPdf {...props} />).toBlob();
