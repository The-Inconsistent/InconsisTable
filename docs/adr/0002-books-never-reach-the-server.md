# Books never reach the server

Status: accepted

## Context

Players sometimes need a printed page. Storing or serving the GM's PDF from our server would make the platform a
distributor of copyrighted books (CLAUDE.md principle 3).

## Decision

The PDF stays on the GM's device. When a player needs a page, the GM's tablet renders the tapped page and the api
relays the image over the `book:*` socket events without storing anything. Printed cards are built in the GM's browser
from data it already holds; nothing is uploaded. Rule entries carry only a page cite, which opens the page through this
relay (design §4.6).

## Considered options

- Upload PDFs to object storage and serve them per seat: simplest for players, but we would hold and distribute books.
- Players bring their own PDFs: breaks the "phones stay at the table" goal and the cite-to-page flow.

## Consequences

- Pages are available only while the GM's tablet is online and has the book loaded.
- The api needs no book storage, but must authorize and size-limit the relay per seat.
- The GM tablet side of `book:*` (`serveBooks`) is not wired yet; it is a P2 item.
