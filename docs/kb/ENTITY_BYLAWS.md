<!-- @hive-protocol: entity-bylaws -->
---
name: Hive Protocol Association — Swiss Verein Bylaws (Template)
purpose: Legal governance document for the entity holding Hive protocol assets (repo, domain, trademark, App, keys). Template to be ratified at genesis; final form requires Swiss counsel review.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
legal_form: Swiss Verein per Civil Code Art. 60ff
seat_canton: TBD (pre-genesis selection)
---

# Bylaws of the Hive Protocol Association (HPA)

*Template — final wording requires Swiss legal counsel review before
filing with the commercial register. NORTHSTAR v0.3 Appendix F lists
the entrenched clauses that cannot be amended by the Association alone.*

## Article 1 — Name and Form

1.1. The name of the Association is **"Hive Protocol Association"**
(French: *Association du Protocole Hive*; German: *Hive Protokoll
Vereinigung*; hereafter "HPA" or "the Association").

1.2. The HPA is a **non-profit association** organized under articles
60 to 79 of the Swiss Civil Code.

1.3. The seat is in the canton of **TBD** (to be selected pre-genesis).
The Association may be active internationally.

## Article 2 — Purpose

2.1. The HPA holds the assets of the Hive protocol — including but not
limited to: the canonical source code repository, domain names,
trademarks, package namespaces, GitHub App, cryptographic keys, and
any operational credentials — on behalf of the protocol's participants
and the broader public.

2.2. The HPA administers these assets **in accordance with the current
version of the NORTHSTAR protocol specification** as maintained at
`docs/kb/NORTHSTAR.md` in the Hive repository.

2.3. The HPA does NOT produce protocol amendments. Amendments emerge
from the §5 RFC process defined in NORTHSTAR. The HPA **implements**
ratifications; it does not author them.

2.4. The HPA does NOT conduct for-profit activities. Any revenue
(per NORTHSTAR INTERNAL-MONETIZATION.md vectors — Enterprise hosting,
cosmetic marketplace, patronage, etc.) flows into a treasury used
exclusively to: (a) cover operational costs (hosting, audit fees,
legal), (b) fund bug bounties per §10.2, (c) remunerate Stewards
at modest fixed rates approved by the membership, and (d) any
residual fund a dissolution-successor entity per Article 11.

## Article 3 — Membership

3.1. The Association has **five (5) seats** on its governing board,
reserved as:
- Seat 1: Steward 1 (NORTHSTAR §2.4).
- Seat 2: Steward 2 (§2.4).
- Seat 3: Steward 3 (§2.4).
- Seat 4: Highest-HEAR non-Steward agent's designated human proxy
  (elected at P3).
- Seat 5: Second-highest-HEAR non-Steward agent's designated human
  proxy (elected at P3).

3.2. **Pre-P3**: Seats 4 and 5 remain empty. All percentage thresholds
in these bylaws are computed over the **5-seat maximum**, not over
filled seats. Until P3, the HPA may only execute acts explicitly
delegated by NORTHSTAR; it may not make discretionary bylaw amendments.

3.3. **Eligibility**: each seat holder must be:
- A natural person (not a legal entity).
- PoP-anchor-disjoint from other seat holders (per NORTHSTAR §3.5 #5(d)).
- Able to sign documents under Swiss law (i.e., legal capacity, not
  under sanctions that would impede the Association's operations).

3.4. **Term**: 2 years per seat, renewable. **No individual may hold
a seat for more than 4 consecutive years** (NORTHSTAR §7.6).

3.5. **Resignation**: 60 days written notice to the Association + the
Hive Bureau of Governance. Seat is temporarily held by the member's
pre-designated alternate or, absent such designation, empty until the
next §5 RFC fills it.

## Article 4 — Decision Rules

4.1. **Operational decisions** (routine administration: hosting bills,
audit contracts, minor corrections): simple majority of filled seats,
with a floor of **3 affirmative votes** out of the 5-seat maximum.

4.2. **Bylaw amendments**: ≥ **4 affirmative votes** of the 5-seat
maximum AND NORTHSTAR §5.8 entrenchment ratification at the community
level AND a Swiss notary attestation of compliance with NORTHSTAR §5.8
(not just compliance with Swiss Civil Code Art. 65).

4.3. **Dissolution**: per Article 11.

4.4. **No proxy voting.** Seat holders vote in person or via signed
written statement for a specific meeting.

## Article 5 — Meetings

5.1. **General Assembly**: at least one per year, with 30 days advance
notice. Minutes published as a NORTHSTAR anchor in
`docs/kb/HPA_MINUTES/` within 7 days of the meeting.

5.2. **Extraordinary meetings**: at the request of any 2 seat holders
OR any 10 participants holding HEAR ≥ 6.0 AND sponsor-disjoint.

5.3. **Quorum**: 3 of 5 maximum seats filled AND physically/remotely
present.

## Article 6 — Transparency

6.1. All HPA decisions, financials, and meeting minutes are **public**
and committed to the Hive repository under `docs/kb/HPA_MINUTES/` and
`docs/kb/HPA_FINANCIALS/` respectively.

6.2. The HPA publishes an annual report per calendar year including:
revenue, expenditure, seat holder stipends, treasury balance, and a
reaffirmation of NORTHSTAR compatibility.

## Article 7 — Entrenched Clauses

The following clauses are **entrenched**: they may only be amended
through NORTHSTAR §5.8 entrenchment (super-majority community vote +
two-cycle ratification) in addition to Article 4.2 bylaw procedure.

- Article 2 (Purpose) — esp. §2.3 (non-authorship of amendments) and
  §2.4 (non-profit form).
- Article 3.1 (seat count and composition).
- Article 3.4 (term limits).
- Article 4.2 (bylaw amendment threshold).
- Article 7 itself.
- Article 11 (dissolution).

## Article 8 — Assets

8.1. Assets held by the HPA are enumerated in
`docs/kb/IP_TRANSFER_ATTESTATION.md` (auditor-signed).

8.2. **The HPA cannot alienate core assets** — repository, domain,
trademark — without triggering Article 11 (dissolution) procedures.
Routine licensing (e.g., NPM publishing) follows Article 4.1.

## Article 9 — Liability

9.1. Seat holders act as volunteers or with modest stipends; they are
not personally liable for Association debts beyond Swiss Civil Code
default protections for non-profit board members.

9.2. The Association carries directors-and-officers insurance funded
by the treasury.

## Article 10 — Disputes

10.1. Disputes between the HPA and any external party: Swiss courts,
canton of the seat.

10.2. Disputes within the HPA: first attempted by Bureau of Governance
arbitration (per NORTHSTAR §4.2), then Swiss courts.

## Article 11 — Dissolution

11.1. **Procedure** (entrenched per Article 7):
- ≥ 4 affirmative votes of the 5-seat maximum AND
- 75% HEAR-weighted vote per NORTHSTAR §5.4 P3 AND
- **1-year mandatory cooling-off period** between ratification and
  asset transfer, during which counter-proposals meeting §5.8
  thresholds NULLIFY dissolution.

11.2. **Successor entity requirements**:
- Successor must publicly commit to a **bit-for-bit adoption of
  NORTHSTAR at dissolution SHA**, attested by a Swiss notary.
- Successor board members must be PoP-disjoint from dissolving HPA
  board AND from each other.
- Successor must be formed as a non-profit in a jurisdiction from a
  pre-approved list (Switzerland Verein, Netherlands Stichting, Panama
  Foundation).

11.3. **Default successor**: if no qualifying successor satisfies
11.2, assets transfer to the **Software Freedom Conservancy** (US
non-profit), with no discretion. NORTHSTAR remains the governing
document under the new fiscal sponsor.

## Article 12 — Genesis Commitment

12.1. These bylaws take effect at the genesis ceremony (NORTHSTAR
§13.2). Pre-genesis, the Association operates as a "founding
committee" with only Seat 1 filled by `noemuch`; Seats 2 and 3 are
filled at genesis from the top testnet bug bounty reporters.

12.2. The founding committee, between pre-genesis and genesis, is
authorized only to: file the Association with the Swiss commercial
register, open a bank account, accept asset transfers from `noemuch`
(IP, domain, repo, etc.), and engage legal counsel for the final bylaws
drafting. No substantive governance is permitted pre-genesis.

---

## Appendix A — Swiss Legal References

- Civil Code articles 60-79 (Associations).
- Commercial Register filing procedure (canton-specific).
- Non-profit tax-exempt status request (cantonal tax authority).
- Anti-money-laundering filings (if treasury exceeds CHF 100k/year).

## Appendix B — Draft Signing Ceremony

At genesis:
1. Three Stewards sign these bylaws with physical signatures + GPG co-signature on the SHA-256 of the committed `ENTITY_BYLAWS.md`.
2. Swiss notary witnesses the physical signing + attests NORTHSTAR compliance.
3. Commercial register filing submitted same day.
4. Filing confirmation (usually 2-4 weeks post-submission) triggers §13.1 checklist "Swiss commercial register filing complete".

---

**End of ENTITY_BYLAWS.md template (pre-genesis draft).**
