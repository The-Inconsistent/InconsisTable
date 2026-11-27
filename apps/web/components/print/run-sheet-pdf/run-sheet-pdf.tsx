import { Document, Page, pdf, Text, View } from "@react-pdf/renderer";

import { INK, PT, type Paper } from "@/lib/print/constants";
import type { RunLine, RunSheet } from "@/lib/print/run-sheet";

import { s } from "../styles";

/** The run sheet's own headings, in the reader's language. */
export type RunWords = { readAloud: string; gmNotes: string; budget: string; fields: string };

type RunSheetPdfProps = { sheet: RunSheet; paper: Paper; breaks: boolean; words: RunWords };

function Lines({ lines }: { lines: RunLine[] }) {
  return lines.map((l, i) => (
    <View key={i} style={{ marginBottom: "1.5mm" }}>
      <Text style={s.label}>{l.label}</Text>
      {l.items.map((item, j) => (
        <Text key={j}>• {item}</Text>
      ))}
    </View>
  ));
}

function Notes({ label, text }: { label: string; text: string }) {
  return (
    text.trim() !== "" && (
      <View style={{ marginBottom: "1.5mm" }}>
        <Text style={s.label}>{label}</Text>
        <Text>{text}</Text>
      </View>
    )
  );
}

// The GM's run sheet (issue #4): an adventure's scenes in play order, packed densely unless each asks for a new page.
export function RunSheetPdf({ sheet, paper, breaks, words }: RunSheetPdfProps) {
  return (
    <Document title={sheet.title} creator="InconsisTable">
      <Page size={paper} style={s.page}>
        <Text style={s.title}>{sheet.title}</Text>
        {sheet.intro.trim() !== "" && <Text style={{ marginBottom: "2mm" }}>{sheet.intro}</Text>}
        <Notes label={words.gmNotes} text={sheet.gmNotes} />
        {sheet.scenes.map((scene, i) => (
          <View key={i} break={breaks && i > 0}>
            <Text style={s.head} minPresenceAhead={60}>
              {i + 1}. {scene.title}
            </Text>
            {scene.readAloud.trim() !== "" && (
              <View style={{ borderWidth: 1, borderColor: INK.line, padding: "2.5mm", marginBottom: "2mm" }}>
                <Text style={{ ...s.label, marginBottom: "1mm" }}>{words.readAloud}</Text>
                <Text style={{ fontSize: PT.body + 1, lineHeight: 1.35 }}>{scene.readAloud}</Text>
              </View>
            )}
            {scene.fields.length > 0 && (
              <Lines lines={[{ label: words.fields, items: scene.fields.map((f) => `${f.label}: ${f.value}`) }]} />
            )}
            <Lines lines={scene.links} />
            <Lines lines={scene.lines} />
            {scene.budget.length > 0 && <Lines lines={[{ label: words.budget, items: scene.budget }]} />}
            <Notes label={words.gmNotes} text={scene.gmNotes} />
          </View>
        ))}
        <View style={s.foot} fixed>
          <Text>{sheet.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export const runSheetPdf = (props: RunSheetPdfProps) => pdf(<RunSheetPdf {...props} />).toBlob();
