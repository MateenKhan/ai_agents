# Piranha — End-User License Agreement (Self-Hosted Commercial)

> **DRAFT — NOT YET IN EFFECT. NOT LEGAL ADVICE.**
> This document is a first-pass draft prepared for the Owner's internal review. It has **not**
> been reviewed by a qualified attorney. Do not ship it, link to it from a purchase flow, or
> present it to a customer until a licensed lawyer in the relevant jurisdiction has reviewed and
> adapted it. Bracketed `[PLACEHOLDER]` fields must be filled in before use. Nothing here is
> legal advice, and reading or drafting it does not create an attorney–client relationship.

---

## Preamble

This End-User License Agreement ("**Agreement**") is a legal agreement between you, either an
individual or a single legal entity ("**Licensee**", "**you**"), and **Airtajal** ("**Owner**",
"**we**", "**us**") for the **Piranha** software, a self-hostable multi-agent coding
orchestrator, together with its object code, any accompanying command-line tools, container
images, documentation, and updates the Owner makes available (collectively, the "**Software**").

By installing, activating a license key for, running, or otherwise using the Software, you agree
to be bound by this Agreement. If you do not agree, do not install, activate, or use the
Software. If you are entering into this Agreement on behalf of an organization, you represent
that you have authority to bind that organization, and "you" refers to that organization.

This Agreement governs the commercial, source-available/proprietary distribution of Piranha. It
does **not** govern any separate open-source "lite" edition the Owner may publish, which is
licensed under its own terms.

---

## 1. Definitions

- **"Instance"** — a single running deployment of the Software: one orchestrator process (or one
  fleet hub plus its registered workers operating under a single license) serving a single
  Licensee, on infrastructure the Licensee controls.
- **"Seat"** — one named individual human authorized to direct, configure, or review the work of
  the Software. Automated agents spawned by the Software are not Seats.
- **"Worker"** — a machine running an orchestrator process that pulls tasks from a shared task
  board in fleet mode, identified by a `WORKER_ID`.
- **"License Key"** — the signed activation token the Owner issues that encodes your Tier, Seat
  count, Worker allowance, and expiry.
- **"Tier"** — the commercial plan you purchased (e.g., Solo, Team, Enterprise), as described in
  the Owner's then-current pricing and your order.
- **"Order"** — the purchase record, quote, or online checkout confirming your Tier, quantity,
  term, and fees.
- **"Documentation"** — the Owner's published operating and API documentation for the Software.

---

## 2. Grant of License

Subject to your continuous compliance with this Agreement and payment of all applicable fees, the
Owner grants you a **non-exclusive, non-transferable, non-sublicensable, revocable** license,
during the Term, to:

1. **Install and self-host** the Software on infrastructure you own or control (your own servers,
   workstations, cloud accounts, or private networks);
2. **Run** the number of Instances, Seats, and Workers authorized by your License Key and Order;
3. **Use** the Software's features to orchestrate coding agents against your own source code and
   repositories, including worktree isolation, the human-approved merge gate, local code
   embeddings, cost budgets, and — where your Tier permits — fleet mode across multiple Workers;
4. **Make one copy** of the Software solely for backup or archival purposes.

The license is a license to **use object code and the operational service of the Software**. It
is **not** a sale. All rights not expressly granted are reserved by the Owner.

### 2.1 Tier and quantity scope

Your use is bounded by the Seat count, Worker allowance, and feature Tier encoded in your License
Key and recorded in your Order. Running more Seats or Workers than authorized, or enabling
features gated to a higher Tier, is a material breach and requires a corresponding upgrade.

---

## 3. Restrictions

You shall **not**, and shall not permit any third party to:

1. **Redistribute** — sell, resell, rent, lease, lend, host as a service for third parties,
   sublicense, publish, or otherwise make the Software (or your License Key) available to anyone
   outside your organization. Operating Piranha as a multi-tenant SaaS for third parties is
   expressly prohibited without a separate written agreement.
2. **Reverse-engineer** — decompile, disassemble, or otherwise attempt to derive the source code,
   underlying ideas, or algorithms of any object-code portion of the Software, except to the
   limited extent this restriction is prohibited by applicable law.
3. **Modify to circumvent** — alter, disable, bypass, or interfere with the license-key
   validation, activation, Seat/Worker metering, expiry enforcement, or any technical protection
   in the Software; or generate, forge, or tamper with License Keys.
4. **Remove notices** — remove, obscure, or alter any copyright, trademark, license, or
   proprietary-rights notice in the Software or Documentation.
5. **Exceed scope** — use the Software beyond the Seats, Workers, Instances, or Tier features you
   are licensed for.
6. **Compete** — use the Software to build, train, or improve a competing multi-agent
   orchestration product, or to benchmark it for the purpose of building such a product, without
   the Owner's prior written consent.
7. **Unlawful use** — use the Software in violation of applicable law, or to develop or operate
   software the primary purpose of which is unlawful.

The Owner may make portions of the source code available for transparency, audit, or
self-hosting convenience. Any such access does **not** grant rights beyond those in Section 2 and
does not waive the restrictions in this Section 3.

---

## 4. License Keys, Activation, and Verification

1. Use of the Software requires a valid License Key. The Software validates the key **locally**
   using cryptographic signature verification and does not require contacting the Owner's servers
   to operate ("offline-friendly activation").
2. You are responsible for keeping your License Key confidential. A key is scoped to your
   organization and must not be shared outside it.
3. The Software may record local, non-transmitted metering (e.g., active Seats and Workers) to
   enforce the scope of your license. In self-hosted operation, this data stays on your
   infrastructure. See the licensing-model design document for details.
4. The Owner may issue replacement keys on renewal, upgrade, or downgrade. On expiry, the
   Software may enter a limited grace period as described in the Documentation, after which
   licensed features may be disabled until a valid key is present.

---

## 5. Ownership and Intellectual Property

The Software is licensed, not sold. The Owner and its licensors retain all right, title, and
interest in and to the Software, including all intellectual-property rights. This Agreement grants
you no rights to the Owner's trademarks, service marks, or trade names.

**Your content.** As between the parties, you retain all rights to your source code,
repositories, prompts, task definitions, and other data you process with the Software ("**Your
Content**"). The Owner claims no ownership of Your Content. Because Piranha is self-hosted, Your
Content and any credentials (API keys, git tokens, the secrets master key) remain on
infrastructure you control; the Owner does not receive them in the ordinary course of your
self-hosted operation.

**Feedback.** If you send the Owner suggestions or feedback, you grant the Owner a perpetual,
irrevocable, royalty-free license to use it without restriction or obligation to you.

---

## 6. Third-Party Components and Dependencies

The Software orchestrates and may invoke third-party tools and services, including headless
coding-agent CLIs (for example, Claude Code and, in later releases, other engine adapters) and
model providers. Your use of those third-party tools and services is governed by their own terms
and pricing, and you are responsible for obtaining and complying with them, including any usage
limits and model-provider agreements. The Software may include open-source components licensed
under their own terms; those terms govern those components and, to the extent they conflict with
this Agreement for those components, control.

---

## 7. Term and Termination

1. **Term.** This Agreement begins when you first install or activate the Software and continues
   for the subscription or license term stated in your Order (the "**Term**"), including
   renewals.
2. **Termination for breach.** The Owner may terminate this Agreement immediately if you
   materially breach it — including any breach of Section 3 (Restrictions) — and fail to cure the
   breach within [30] days of notice, or immediately for breaches incapable of cure.
3. **Termination for non-payment.** The Owner may suspend or terminate the license if fees are
   not paid when due.
4. **Effect of termination.** On termination or expiry, your license ends. You must stop using
   the Software and, on request, delete or destroy all copies in your possession, except backups
   retained as required by law, which remain subject to this Agreement. Sections 3, 5, 8, 9, 10,
   and 11 survive termination.
5. **No refund on termination for breach.** Termination for your breach does not entitle you to a
   refund of prepaid fees, except as required by law.

---

## 8. Warranty Disclaimer

THE SOFTWARE IS PROVIDED "**AS IS**" AND "**AS AVAILABLE**", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE, TITLE, AND NONINFRINGEMENT. THE OWNER DOES NOT WARRANT THAT THE SOFTWARE WILL
BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT IT WILL MEET YOUR REQUIREMENTS.

**You are responsible for the Software's output.** Piranha drives automated coding agents that
generate, modify, and merge code and can execute commands. Agent output may be incorrect,
incomplete, insecure, or unsuitable. The human-approved merge gate is a control you must
exercise; you are solely responsible for reviewing, testing, and accepting any change before it
lands in your systems, and for the consequences of running the Software against your repositories
and infrastructure.

---

## 9. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL THE OWNER BE LIABLE FOR ANY INDIRECT,
INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOST PROFITS, LOST
REVENUE, LOST OR CORRUPTED DATA OR CODE, BUSINESS INTERRUPTION, OR COST OF SUBSTITUTE SOFTWARE,
ARISING OUT OF OR RELATED TO THIS AGREEMENT OR THE SOFTWARE, WHETHER IN CONTRACT, TORT (INCLUDING
NEGLIGENCE), OR OTHERWISE, EVEN IF THE OWNER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

THE OWNER'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT SHALL NOT EXCEED
THE GREATER OF (a) THE TOTAL FEES YOU ACTUALLY PAID TO THE OWNER FOR THE SOFTWARE IN THE
**TWELVE (12) MONTHS** IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (b)
**[USD $100]**.

Some jurisdictions do not allow the exclusion or limitation of certain warranties or liabilities;
in those jurisdictions the Owner's liability is limited to the smallest amount permitted by law.
This Section allocates risk between the parties and is reflected in the fees.

---

## 10. Indemnification

You will defend, indemnify, and hold harmless the Owner from and against any third-party claims,
damages, and costs (including reasonable legal fees) arising out of (a) Your Content, (b) your use
of the Software in violation of this Agreement or applicable law, or (c) code or actions the
Software produced under your direction and that you accepted through the merge gate.

---

## 11. General

1. **Governing law.** This Agreement is governed by the laws of **[GOVERNING JURISDICTION —
   e.g., State/Province, Country]**, without regard to its conflict-of-laws rules. The parties
   submit to the exclusive jurisdiction of the courts located in **[VENUE]**. *(The Owner should
   set these to its home jurisdiction; consult counsel on enforceability against foreign
   customers and on any consumer-protection carve-outs.)*
2. **Export and sanctions.** You will comply with all applicable export-control and sanctions
   laws and will not use or export the Software in violation of them.
3. **Assignment.** You may not assign this Agreement without the Owner's prior written consent.
   The Owner may assign it in connection with a merger, acquisition, or sale of assets.
4. **Entire agreement.** This Agreement, together with your Order and the Documentation
   referenced here, is the entire agreement between the parties on this subject and supersedes
   prior discussions. If there is a conflict, a signed written agreement between the parties
   controls over this Agreement, which controls over the Documentation.
5. **Severability and waiver.** If any provision is held unenforceable, the rest remains in
   effect. A failure to enforce a provision is not a waiver.
6. **Changes.** The Owner may update this Agreement for future versions or renewal terms;
   material changes will be communicated, and continued use after they take effect constitutes
   acceptance for the version to which they apply.
7. **Notices.** Notices to the Owner should be sent to **[OWNER LEGAL CONTACT / ADDRESS]**.
8. **Relationship to the LICENSE file.** This Agreement supplements and operationalizes the
   proprietary `LICENSE` file distributed with the Software. Where a signed commercial license
   grants specific use rights, those rights are defined here; the reservation of rights and the
   warranty/liability posture mirror the `LICENSE` file's tone.

---

*End of draft. `[PLACEHOLDER]` fields and bracketed durations/amounts must be completed, and the
whole document reviewed by counsel, before any commercial use.*
