import Link from "next/link";

import { SCREENS, VARIANTS, type Screen, type Variant } from "./_data/variants";

export default function ProtoIndex() {
  return (
    <main className="proto-index">
      <h1>Base theme prototype</h1>
      <p>Same real components, same fake data, three looks. Open on the phone and the tablet.</p>
      <table>
        <thead>
          <tr>
            <th>Variant</th>
            {(Object.keys(SCREENS) as Screen[]).map((s) => (
              <th key={s}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(Object.keys(VARIANTS) as Variant[]).map((v) => (
            <tr key={v}>
              <td>
                <strong>{v}</strong>
                <br />
                {VARIANTS[v]}
              </td>
              {(Object.keys(SCREENS) as Screen[]).map((s) => (
                <td key={s}>
                  <Link href={`/proto/${v}/${s}`}>open</Link>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Phone Test prompt after the roll: add <code>?t=result</code> to a phone URL.
      </p>
    </main>
  );
}
