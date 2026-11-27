// Renamed: a PDF image has no alt text, and the lint rule for an HTML <Image> would ask for one.
import { Circle, Document, Image as PdfImage, Page, pdf, Svg, Text, View } from "@react-pdf/renderer";

import type { HandoutPage } from "@/lib/print/cards";
import { INK, PT, type Paper } from "@/lib/print/constants";

import { s } from "../styles";

type HandoutSheetProps = {
  pages: HandoutPage[];
  paper: Paper;
  title: string;
  /** Each handout's picture as a PNG data URL, by handout id, for those this seat may see. */
  pictures: ReadonlyMap<string, string>;
  /** The proclamation's line under the seal. */
  signed: string;
};

const INSET = "7mm"; // the frame's distance from the paper edge, inside a home printer's margin
const at = (inset: string) => ({ position: "absolute" as const, top: inset, left: inset, right: inset, bottom: inset });

// The frame a layout draws round every page of its handout, so a long one still looks like the same prop on page 2.
function Frame({ layout }: { layout: HandoutPage["layout"] }) {
  if (layout === "plain") return null;
  if (layout === "proclamation")
    return (
      <>
        <View fixed style={{ ...at(INSET), borderWidth: 1.6, borderColor: INK.line }} />
        <View fixed style={{ ...at("8.6mm"), borderWidth: 0.5, borderColor: INK.line }} />
      </>
    );
  const width = { tablet: 4, form: 1.4, transcript: 0.6 }[layout];
  return <View fixed style={{ ...at(INSET), borderWidth: width, borderColor: INK.line }} />;
}

const Noise = () => (
  <View style={{ borderTopWidth: 1, borderTopColor: INK.faint, borderStyle: "dashed", marginVertical: "3mm" }} />
);

// One handout as the printed prop (house decision #72's five layouts, in ink on white).
function Body({ page, signed }: { page: HandoutPage; signed: string }) {
  const text = { fontSize: PT.body + 1, lineHeight: 1.45 };
  const head = page.header !== "" && page.layout !== "plain" && (
    <Text
      style={{
        ...s.label,
        fontSize: page.layout === "proclamation" ? 15 : PT.head,
        textAlign: page.layout === "tablet" || page.layout === "proclamation" ? "center" : "left",
        marginBottom: "4mm",
      }}
    >
      {page.header}
    </Text>
  );
  if (page.layout === "transcript")
    return (
      <>
        {head}
        <Noise />
        {page.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: "row" }} wrap={false}>
            {l.stamp !== null && <Text style={{ ...text, ...s.bold, width: "22mm" }}>{l.stamp}</Text>}
            <Text style={{ ...text, flex: 1 }}>{l.text || " "}</Text>
          </View>
        ))}
        <Noise />
      </>
    );
  return (
    <>
      {page.layout === "form" ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            borderBottomWidth: 1,
            borderBottomColor: INK.line,
            paddingBottom: "2mm",
            marginBottom: "4mm",
          }}
        >
          <Text style={s.label}>{page.header}</Text>
          <View style={{ width: "16mm", height: "16mm", borderWidth: 0.8, borderColor: INK.line }} />
        </View>
      ) : (
        head
      )}
      <Text style={text}>{page.body}</Text>
      {page.layout === "proclamation" && (
        <View wrap={false} style={{ flexDirection: "row", alignItems: "center", marginTop: "8mm" }}>
          <Svg viewBox="0 0 52 52" style={{ width: "14mm", height: "14mm" }}>
            <Circle cx={26} cy={26} r={21} fill="none" stroke={INK.line} strokeWidth={6} strokeDasharray="3 2.2" />
            <Circle cx={26} cy={26} r={13} fill="none" stroke={INK.line} strokeWidth={1.5} />
          </Svg>
          <View style={{ flex: 1, marginLeft: "4mm", borderTopWidth: 0.6, borderTopColor: INK.line, paddingTop: 2 }}>
            <Text style={{ ...s.small, textAlign: "right" }}>{signed}</Text>
          </View>
        </View>
      )}
    </>
  );
}

// Handouts, one to a page at A5, A4 or Letter; a long one runs on, its frame repeated. The picture leads, when sent.
export function HandoutSheet({ pages, paper, title, pictures, signed }: HandoutSheetProps) {
  return (
    <Document title={title} creator="InconsisTable">
      {pages.map((page) => {
        const picture = pictures.get(page.id);
        return (
          <Page key={page.id} size={paper} style={{ ...s.page, padding: "15mm 14mm" }}>
            <Frame layout={page.layout} />
            {picture && (
              <PdfImage src={picture} style={{ maxHeight: "70mm", objectFit: "contain", marginBottom: "4mm" }} />
            )}
            <Body page={page} signed={signed} />
          </Page>
        );
      })}
    </Document>
  );
}

export const handoutsPdf = (props: HandoutSheetProps) => pdf(<HandoutSheet {...props} />).toBlob();
