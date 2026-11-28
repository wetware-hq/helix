# `organize-stack` — where helix sits over the DNA primitive

`type: resource.map` · `spec: agent.map` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

Across wetware-hq, DNA means one object: a single sequence over `ACGT`, defined by `wetware-hq/web` (`dna.md`, contract §13). helix is the top layer of the stack. It writes claims about chromosomes and stores no sequence. This file says what reaches helix from each layer below and what it is called here.

## Specification

```json { type: notebook.cell }
{
  "id": "docs/organize-stack.md",
  "type": "resource.map",
  "role": "place helix in the wetware stack and name each value that reaches a page",
  "reads": ["wetware-hq/web contract §13", "genome.json chain"],
  "writes": [],
  "must": ["no base on any page", "sequence-root is a chain root", "reach a chromosome by token id, never by root comparison"],
  "check": ["H-stack"]
}
```

## Graph

- ← [follow-agent-contract.md](follow-agent-contract.md)
- → [pin-references.md](pin-references.md)

## Hierarchy

```text { type: notebook.cell }
wetware-hq
  tesseract   .tess   build plan          -> plan root           (scratch, via the dna: page subject)
  web         .dna    sequence, primitive -> sequence root       (never reaches helix)
              pool1   arr<oligo>          -> reads of a print
              loop1   read-back loop      -> head, printed receipt
              .web    shallow network     -> web root            (not a dna: value)
  bases       token   chromosome, ERC-721 -> token id, root, length, head
  helix       page    dna:<token id>      -> locus root          (this repository)
```

| From | Value | On a `dna:` page |
|---|---|---|
| `bases` | token id | the page ID `dna:<token id>` |
| `bases` | `root` = `sha256(salt \|\| ascii(seq))`, the **chain root** | `sequence-root`, fixed at mint |
| `bases` | length in bases | `length`, fixed at mint |
| `bases` + `web` loop1 | `Polymerized` receipt = loop head | `printed` |
| `tesseract` | plan root, over a target sequence root | scratch `plan` claim on the page subject (owned by the tesseract change) |

Current ownership is queried directly from `Bases`; helix does not snapshot transfer-sensitive state.

## Rules

- **No bases.** A page holds roots, counts, lengths and receipts. A claim whose value holds a base is refused like any free text (contract §1).
- **`sequence-root` is a chain root.** It is the salted Bases `root`, not web's unsalted sequence root `sha256(ascii(seq))`. The two never compare equal. A tesseract target, a loop header and a pool file name the unsalted sequence root; they reach a page by its token id, and only someone holding the salt can show they name the page's sequence.
- **One name per value.** A web root, a sequence root, a chain root, a loop head, a plan root and a locus root are different objects. A claim of one predicate never holds another's value.
- **Pin, never vendor.** web, bases and tesseract are cited by repository and commit (`docs/pin-references.md`); none of their files are copied here.

## Falsification

- A page, a claim or `genome.json` holds a run of bases.
- A reader accepts `sha256(ascii(seq))` as a `dna:` page's `sequence-root`, or a `sequence-root` as a web root.

## Licence

MIT, see `LICENSE`.
