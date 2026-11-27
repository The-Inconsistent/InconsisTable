import { Document, Page, pdf, Text, View } from "@react-pdf/renderer";

import type { CardStat, PrintCard } from "@/lib/print/cards";
import { CARD_COLS, CARD_H_MM, CARD_ROWS, CARD_W_MM, INK, PAPER_MM, PT, type Paper } from "@/lib/print/constants";

import { s } from "../styles";

type CardSheetProps = { pages: PrintCard[][]; paper: Paper; title: string };

// A long name steps down so it stays on the face the table reads across it.
const nameSize = (name: string) => (name.length <= 14 ? PT.tent : name.length <= 24 ? 15 : 12);

function Stats({ stats, columns }: { stats: CardStat[]; columns: number }) {
  return (
    <View style={s.row}>
      {stats.map((st, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, alignItems: "center", marginBottom: "1.5mm" }}>
          <Text style={{ ...s.label, textAlign: "center" }}>{st.label}</Text>
          <Text style={s.statValue}>{st.value}</Text>
        </View>
      ))}
    </View>
  );
}

// Folded across the middle, it stands behind the miniature. The top half prints upside down so it reads the right way
// up once folded: the players' side, the name. The GM's side faces back with the numbers.
// ponytail: no portrait until characters carry a picture (#238); draw it above the name then.
function Tent({ card }: { card: Extract<PrintCard, { kind: "tent" }> }) {
  const half = { height: `${CARD_H_MM / 2}mm`, padding: "3mm", alignItems: "center" } as const;
  return (
    <>
      <View style={{ ...half, justifyContent: "center", transform: "rotate(180deg)" }}>
        <Text style={{ fontSize: nameSize(card.name), fontWeight: 700, textAlign: "center" }}>{card.name}</Text>
      </View>
      <View style={{ borderTopWidth: 0.6, borderTopColor: INK.faint, borderStyle: "dashed" }} />
      <View style={half}>
        <Text style={{ ...s.bold, marginBottom: "2mm", textAlign: "center" }}>{card.name}</Text>
        <Stats stats={card.stats} columns={3} />
      </View>
    </>
  );
}

function Face({ card }: { card: Exclude<PrintCard, { kind: "tent" }> }) {
  return (
    <View style={{ padding: "3mm", height: "100%" }}>
      <Text style={s.cardTitle}>
        {card.name}
      </Text>
      {card.kind === "creature" && card.tags.length > 0 && <Text style={s.small}>{card.tags.join(", ")}</Text>}
      <View style={{ marginTop: "2mm" }}>
        <Stats stats={card.stats} columns={2} />
      </View>
      {card.kind === "item" && card.text !== "" && <Text style={s.small}>{card.text}</Text>}
      {card.cite && <Text style={{ ...s.small, position: "absolute", bottom: "3mm", right: "3mm" }}>{card.cite}</Text>}
    </View>
  );
}

// Poker cards at true size on a centred 3 × 3 grid. Each card sits at absolute mm, so only the printer's own scaling
// can move it: the dialog says to print at 100 %. Grey edges are the cut lines.
export function CardSheet({ pages, paper, title }: CardSheetProps) {
  const sheet = PAPER_MM[paper];
  const left = (sheet.w - CARD_COLS * CARD_W_MM) / 2;
  const top = (sheet.h - CARD_ROWS * CARD_H_MM) / 2;
  return (
    <Document title={title} creator="InconsisTable">
      {pages.map((page, i) => (
        <Page key={i} size={paper} style={{ ...s.page, padding: 0 }}>
          {page.map((card, j) => (
            <View
              key={j}
              wrap={false}
              style={{
                position: "absolute",
                left: `${left + (j % CARD_COLS) * CARD_W_MM}mm`,
                top: `${top + Math.floor(j / CARD_COLS) * CARD_H_MM}mm`,
                width: `${CARD_W_MM}mm`,
                height: `${CARD_H_MM}mm`,
                borderWidth: 0.4,
                borderColor: INK.faint,
                overflow: "hidden",
              }}
            >
              {card.kind === "tent" ? <Tent card={card} /> : <Face card={card} />}
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}

export const cardsPdf = (props: CardSheetProps) => pdf(<CardSheet {...props} />).toBlob();
