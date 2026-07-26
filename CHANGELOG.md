# Changelog

All notable changes to the Freelane macOS app. The section matching the app's
version is shown as in-app release notes when you update.

## 2.8

The question you answered twenty times finally stops.

- **"What kind of place is Sari Sari store?" was unanswerable by design.** Your answer was filed as a fact about *you* — `user:_:vendor_sari_sari_store` — while the sweep that decides whether to ask looked under the vendor subject, at `vendor:sari_sari_store:sari_sari_store`. Two different addresses, so answering the question could not possibly satisfy it. Nor could dismissing it: "don't ask me again" was written to the same unread address.
- **Even the AI's own identifications never landed.** `setVendorKind` slugged the name with one rule (spaces → "-"), handed it to the memory store, which slugged it again with a different rule (→ "_"), and saved it somewhere the reader never looked. A single-word shop happened to survive both rules and worked fine; anything with a space in its name — which is most shops — was permanently unidentifiable.
- **Every one of those answers was going into the model's brief about you.** The vendor subject exists precisely so shop classifications don't show up in "what I know about them", and the answer path bypassed it. Twenty replies of "Groceries" and "Eating out" had been sitting in your belief store as things the app believed about *you*.
- **A one-time repair moves them.** On first launch those answers are re-filed under the vendors they describe and retired from your beliefs, so the questions stop immediately rather than after one more ask. Questions already sitting in the inbox are recognised and handled correctly too.
- **The address of a fact is now computed in exactly one place.** Three callers were building it by hand with three different rules; the one that slugged and the ones that didn't could never agree. That whole class of bug is gone.

## 2.7

Stop telling you Apple's model is broken when it is working exactly as designed.

- **"On-device keeps failing" was never a failure.** Apple's built-in model has a safety filter that can't be configured or turned off, and it refuses first-person emotional writing. The nightly pass that tags your journal entries was sending them to that model — up to eight private entries a night, each one certain to be refused — because reading an entry *looks* like the same kind of small extraction job as sorting a spend. It isn't. Journal reading now goes to the downloaded model, which was built to read it.
- **A refusal is no longer counted as a fault.** Declining content is a policy outcome, not a malfunction: the app already falls through to the next brain, and that is the entire remedy. It's recorded, and it's silent.
- **The warning could never stop.** The circuit breaker only ever tripped for a brain that had *never once* succeeded — so one that worked on short transactional prompts and refused long personal ones stayed at the head of the queue permanently, and each success re-armed the alert. That was an unbreakable loop about something you cannot fix. A brain now also drops out after eight consecutive genuine failures, whatever it managed last week.
- **The notification pointed at a page with nothing on it.** "Check Settings → Intelligence" led to a card that never mentioned brains, because the health display had been written but never rendered. Settings → Intelligence now says the two things that can be true — Apple's model has declined N requests and that's fine, or a brain has been dropped and here's a button to try it again — and shows nothing when both are behaving.
- Fixed the message reading "…safety guardrails were triggered.." with two full stops.

## 2.6

The app finally uses its own design system — and categories get a face.

- **Every gap in the app is now one of thirteen numbers, and every piece of text one of ten.** There was a `Spacing` scale in the design system, written during the v1 audit specifically to stop screens hand-tuning magic numbers. It was used **seven times**, against 893 hardcoded values that had grown to fifty-one distinct gaps — including 7.5, 23, 41 and 46 — and twenty-eight font sizes, seven of which differed from their neighbour by half a point. Half a point is invisible; what it isn't is free, because it guarantees nothing ever shares a baseline. That is the entire reason the app read as assembled rather than composed, and 586 sites have been snapped to the ladder.
- **Spending categories have a mark now.** Vendors have had real logos since 1.5, but categories — the thing you actually budget by, sort by, and filter the ledger with — had a hashed colour smeared along a 4pt bar. Groceries are a green basket, fuel a red pump, transport a cyan car, rent an indigo house; anything unrecognised still gets a stable colour and a tag glyph, so every category has a face. Categories are a small set you see daily, and after a week you stop reading the word and just look for the shape.
- **Category colour means something.** It was picked by hashing the name, so "Fuel" was whatever hue the hash landed on. Where the category is recognisable the hue now comes from meaning, and the hash is only the fallback.
- **Spends with no vendor stopped all looking identical.** Rent, a bus fare and a doctor's bill were three of the same amber blob; each now wears its category's mark.
- **Dashboard card labels were being cut off** — "Landed this month" shipped as "LANDED THIS MO…" on a card whose only job is to be read at a glance. Labels wrap to two lines, and the space is reserved whether they need it or not, so the figures across a row stay on one baseline instead of three.

## 2.5

A pass over the whole app: the last streak, the button that did nothing, and every number that was printed twice.

- **The last two streaks are gone.** The journal's streak system was removed in 1.0 because a counter that can only be broken turns a habit into a debt. Two survived on other pages: a flame on "Spent today" counting consecutive days of logging, and — in the prayer tracker, of all places — a chain that reset to zero the first day you missed one. Prayer now shows how many complete days you've had this month: a number that only goes up, where a missed day costs you the day and not the month.
- **The "Budgets" button on Spending did nothing.** It set the flag that opens the budgets sheet, but the only place that sheet was attached was a card that stopped being rendered when the category rail replaced it. Clicking it was a no-op. The presentation now lives on the page.
- **Sheets are the size of what they hold.** All twenty-four were locked to 540×600 whatever was in them, so "New client" — one text field — opened at full height with four hundred points of empty scroll under it and a fade mask hinting at content that wasn't there. Forms now take the height they need and only start scrolling once they'd outgrow the old size.
- **Project cards stopped printing the same number three times.** An untouched project showed its fee as the headline, again as "₱X left", and a third time inverted as "₱0 received", over a progress bar pinned at zero. A settled one showed it twice. Money in flight is the only state where the split tells you something you don't already have, so it's the only state that shows one.
- **The front page no longer previews itself.** The lead figure's sub-line read "Safe ₱X today · 19-day runway · 3 open projects" directly above cards headed "Safe to spend" and "Active projects" holding those exact figures. It now says what the grid has no card for: how the total is spread across wallets, and how long it lasts at your pace. Today lost the same kind of echo, and Insights stopped printing its fee total twice within a hundred points.
- **Amounts in People, search results and the mood/money read were hardcoded to pesos.** They're base-currency figures being drawn with a ₱ sign, so switching base relabelled every total in the app except those. Every payment form also opened with PHP pre-selected regardless of your base.
- **The base-currency picker stopped offering dead ends.** Choosing a currency with no exchange rate walked you through a red destructive confirmation, took a full backup, and then failed. Those currencies aren't listed.
- **Snoozing a notification told you nothing.** It removed the row from both tabs — no longer unread, no longer live — with no confirmation and no way back until the snooze expired. Snooze and "stop showing these" both offer an undo now. The dot on the leading edge of a notification means unread again, the way it does everywhere else on the Mac; it was drawn on every row of the Read tab too.
- **Quick capture can be undone, and says so when it fails.** A failed save used to clear the field and report nothing, so the only sign was a number that never appeared. Every one-tap log from the menu bar — including the ↺ button sitting inches from the amount you meant to click — now offers an undo.
- **One progress bar, not five.** Four screens drew a meter with the stock AppKit control, each squashed by its own scale factor to fight its thickness, none of them matching the one the project card drew by hand.
- **Nineteen icon-only buttons had no tooltip at all**, and lists that showed the first six of nine said "9" in the header with nothing to say the rest existed.
- Removed the suggested-question pills' fake wrapping (a stack pretending to be a flow layout), five dead view components including a whole unrendered Settings card, and two full-table fetches that ran on every journal save and were thrown away.

## 2.4

Cards that read themselves, and a sidebar that looks like the system it runs on.

- **The dashboard figures are cards now, and the card carries the verdict.** The rail was better for dense comparison, but that density was exactly the problem: every number looked equally fine, so nothing on the front page told you where to look. Green ground means healthy, red means it wants you, plain grey means it's just a fact. You scan the colours and stop on what isn't grey. The tint is deliberately weak — 9–12% — because saturated blocks would make a money app feel like a game.
- **Money owed to you reads as red**, not because it's a loss but because it's money that hasn't arrived. Fees read red for the same reason. Sadaka and money landed read green.
- **One layout instead of two.** The rail was pinned at a fixed 262pt on wide windows with a separate stacked branch for narrow ones — two layouts to keep in sync, and on a wide Mac window it was a thin strip of text beside a mostly-empty column. The card grid reflows on its own and gets the full width.
- **Sidebar icons are colour tiles**, the macOS 27 convention: a filled rounded square per destination with a white glyph, each a distinct hue, so you navigate by colour and shape before you read the word. A tinted square is decoration on a content grid — it's the convention on a navigation list, which is the opposite call from the one made in 1.8, and the right one here.
- **"Stored on this Mac" floats at the bottom of the sidebar** above a hairline, instead of scrolling away with the list. It's a standing fact about the app, not the last item in the navigation.

## 2.3

The charts, and the last of the Settings faults.

You said what you like about Cashew isn't the colours — it's that everything looks intentionally placed, and the charts are genuinely well made. That's a fair reading of where this app was weakest: the charts worked but nothing about them was *considered*.

- **Cash flow reads its own answer now.** The fill is split at zero and coloured by side — green above, oxblood below — so the single most important fact on a cumulative line, which side of zero you're on, is carried by the shape instead of by an axis you have to read. The zero rule only appears when the line actually crosses it (a baseline you never touch is furniture), today's position is marked with its figure, and the horizontal grid is gone — it was drawing rulings straight through a filled area and muddying it. Three axis labels instead of six.
- **The cash-flow forecast on Agenda speaks the same language**, so the moment your projection dips under is a change in the shape, and the lowest point says "lowest".
- **Income bars are coloured against your own average** — green months beat your 12-month average, grey months don't. The average line was previously the only thing carrying that, and you had to trace across the chart to use it.
- **Categories have identity.** Every category bar was the same ochre, so ranking was carried by length alone and nothing was memorable between visits. Each now has a stable colour derived from its name — a budget going over still overrides it, because that's more urgent than knowing which category it is.

### Settings

- **Denied permissions explain themselves.** If macOS has Reminders or Contacts blocked, it shows no prompt at all — the switch just snapped back with no explanation, which reads as the app being broken. It now says so and opens the right pane.
- **"Recalibrate wallets" moved out of Storage** — a tab about disk location and backups was hosting a control that writes real ledger adjustments, one stray click from someone who came to make a backup.

## 2.2

Ordering, plain language, and a real Settings pass.

- **Safe to spend comes before what the AI noticed.** On a narrow window the figure rail was rendered last, so the number you check every day sat below the lead panel, the weather banner, the observations and the chart — you had to scroll past what the app *thought* to reach what you came for. It now sits immediately under the balance.
- **"Net cash flow · Cumulative across all wallets · 90 days" is gone.** That's a title written by someone who already knows what the chart shows. It now says **"You're up over 90 days"** with the actual figure and one line explaining what rising means.
- **The balance line no longer touches the panel edge** — it read as clipped rather than as a chart with a floor.

### Settings

- **The Intelligence tab was an operations dashboard for a system with one user.** Three brain rows with status dots, a Private Cloud toggle, a token meter and a failure table with a red FAILING badge — none of which you can act on. Replaced with two sentences saying what actually runs where, and *"Nothing you write is sent anywhere."* Your beliefs — the thing people open that tab to check — now come first.
- **The belief list scrolls instead of truncating.** It showed 12 of however many you have, with no count and no way to see the rest, on the one card whose entire purpose is that you can see and correct what the app thinks it knows.
- **65 lines of unreachable Cloud settings deleted** — the tab was gated behind a compile-time `false`, so the UI, its switch case and its state could never run.
- **"Backed up ✓" no longer latches** for the rest of the session, so a second backup actually tells you it happened, and the store size beside it refreshes.

**On Apple Intelligence:** keeping it, and here's the reasoning. It does the small constant jobs — sorting a spend, reading an entry — instantly and free. The downloaded model takes seconds for those. Removing it would make every spend you log slower for no gain. What was wrong wasn't that it exists; it was being *presented* to you as a decision you had to understand.

## 2.1

The forms — the part you actually type into.

I'd restyled the sheet headers and called the sheets done. The fields inside them were untouched, and they're what you use every day.

- **You can see where the keyboard is now.** Every field suppressed the system focus ring (`.textFieldStyle(.plain)`) and drew a static stroke in its place, so in any sheet with more than one input nothing told you which field had focus. The treatment is now a `ViewModifier` rather than a `TextFieldStyle` — a style struct has no view identity and literally cannot observe focus — so all ~100 fields across the app gained a brand-ink focus ring in one change.
- **Entering an amount looks like money.** It was a plain 15pt text box, identical to "Reference number", for the primary act in a money app. The currency symbol now sits inline and dimmed and the figure is set in the editorial serif at 26pt with tabular digits — the same face the number will appear in once you've saved it.
- **Sheets tell you why you can't save.** Across 22 sheets the only validation was a greyed-out button and silence. The withdrawal sheet gates on three separate conditions; the routed-payment sheet gates on every step in a repeating list. Eleven sheets now name the blocking field — *"Pick the wallet it leaves from"*, *"From and To must be different wallets"*, *"Every step needs a wallet and an amount"*.
- **The journal writes in the face it reads in.** The composer was 15pt system — the app's UI type, used for table cells and buttons — for the only place in the app you write prose. It's now the same editorial serif your finished entries are set in.

## 2.0

The drag pass — the four things I said were left.

- **Auto-scroll no longer stalls.** It computed each step from `scrollX`, which only updates a frame *after* a scroll is issued, so at 60Hz "no change since last frame" came up constantly mid-scroll — and that branch stopped the timer. Since only mouse movement restarted it, the commonest case (hold a card at the board edge and stop moving) killed edge-scrolling for the rest of the drag. It now owns its own position and stops only at the actual ends of the board. It also runs on the `.common` run-loop mode, so it keeps firing while AppKit tracks the mouse — previously it was stalled by the very gesture it exists to serve.
- **The card stays where you grabbed it.** Picking one up snapped its centre to the pointer, so grabbing by a corner jerked it ~110pt before it moved. The ghost now keeps your grab point, and the drop is measured from the ghost rather than the cursor — you could previously cross into the next column and release while the card was visibly still over the previous one.
- **Lanes fill the board.** Columns were only as tall as their contents, so everything below a short column's last card was dead space that rejected drops, the 16pt gutters were dead, and collapsed Paid was a ~50pt strip you had to hit exactly. Anywhere over the board now resolves to the nearest lane.
- **Paid is the same component as the other two columns.** It had a different title size and case, a count in a pill instead of a figure, a glowing dot the others had deliberately dropped, no money at all, and a width that jumped 200↔264 on expand and reflowed the whole board.

Also: cards respond to hover and show a grab cursor, and a drag that never gets an end event — window deactivation, view teardown — no longer leaves a dimmed card, a stranded ghost and a 60Hz timer running.

## 1.9

Three independent reviewers read the code cold. They found things I'd missed.

### Broken, now fixed

- **"Mark work finished" could never be opened.** The card carried its own right-click menu covering its whole surface, which shadowed the outer one holding the delivered toggle. SwiftUI resolves to the innermost. That field sets the board's sort order, so the board sorted by an age you had no way to record.
- **Muting a notification showed you a database key and could never be undone.** The menu read *Mute "ai_clarifying_question" alerts*. It was written in one place, read in one place, and surfaced nowhere else — one accidental click on bill reminders silently suppressed every bill notification forever, in an app whose whole point is not missing a payment. Kinds now have human names, and the inbox shows a permanent "N types hidden · Show all again" row whenever anything is muted.
- **The chat never scrolled to a new message.** No scroll anchor, on a 580pt sheet — you asked, waited twenty seconds, and the screen appeared not to change because the answer landed below the fold.
- **A stray click outside the chat wiped the conversation.** It used the shared sheet chrome, which closes on any outside click, on the one sheet in the app holding unsaved text.
- **The assistant's replies were effectively invisible** — the bubble was `card` at 90% over `ink`, about 1.05:1 contrast. Every answer the product exists to give sat in a bubble you couldn't see.
- **"Free up memory" claimed it had deleted your model.** Both branches of a ternary in my own code returned the same state, so the card offered a Download button for weights already on disk.
- **Your city was discarded unless you pressed Return.** The only save path was `onSubmit`; clicking anywhere else showed the new text while the old value stayed. That value anchors safe-to-spend to local cost of living.
- **Switching base currency rewrote every amount in the database from a default button** — ⏎ fired it — with no backup. It now backs up first, is marked destructive, and names the way back.

### Better

- Chat: focus on open, multi-line composer, selectable and copyable answers, a thinking indicator that becomes "Still thinking… / Stop" after four seconds, and failures rendered as errors rather than as things the assistant said.
- Notifications: flat hairline-separated rows instead of eight shadowed cards stacked inside a card, a larger popover (7–8 rows visible instead of 3), a real **Answer** button in place of the grey hint "Tap to answer", and "Ignore" renamed to **"Don't ask again"** — which is what it actually does, permanently.
- Project cards show **how long a project has been sitting**, the thing you're actually chasing, and use the app's own progress bar instead of the stock system-blue one.
- Drag: the ghost only follows the card that owns the drag, drop targets resolve to the nearest column instead of an arbitrary dictionary order, dropping a card back in its own column is a no-op instead of re-running the whole status-change path, and the spring-back outlasts its own animation.

## 1.8

The rest of the pages, and two things taken away.

- **Sadaka no longer suggests an amount.** It computed a figure and put it on screen as "give this". A number you didn't choose, arriving unprompted on a page about charity, is pressure dressed as help — and the line at the top of that page says *never required*. The suggestion contradicted its own premise. What's left is the fact and the door: what you've given, and a way to give.
- **Wallet cards lost the glow.** A brand-coloured halo on five cards made the page look lit from inside. Neutral shadow now — they read as cards.
- **Payments is a statement.** Every row carries the **balance it left behind**, walked backwards from your real wallet total. You could already see that ₱24,630 landed in July; now you can see what you were sitting on when it did, which is usually the thing you're trying to remember.
- **Agenda has a real spine** — a continuous rule with a node on each date, so the dates and the entries are one timeline read downward instead of two columns sitting near each other.
- **Insights is small multiples.** Four analyses at equal size in a grid, compared by scanning rather than by scrolling. That's the whole point of an analytics page and it's impossible when each one is a full-width card stacked on the last.
- **Journal reads like writing.** Your own prose is now set in the editorial serif at 15.5pt with real line spacing and a measure that stops around 62 characters. It was 14pt system grey running the full sheet width — the same treatment as a table cell, for the one content in this app that is actually prose.
- **Clients have identity.** Each gets a stable colour derived from their name, so the same person is the same colour every time and you find them by sight instead of reading a grid of identical grey initials.

## 1.7

Pages that stop looking like each other.

The fair criticism of 1.5 was that every page had become the same shape — a lead figure and a stack of cards — so the app felt repetitive even where the structure was right. A page should take the form of what it actually is.

- **Wallets look like wallets.** Each one is now a real payment card carrying its brand's colour and logo: coin.ph orange, GCash blue, Wise blue, cash green. You recognise an account the way you recognise it in your pocket, before reading a word. They lift and tilt very slightly toward you on hover — enough to feel physical, far short of the novelty flip that would make a money app feel like a toy.
- **Loans is a balance, drawn as one.** Lending is the one genuinely two-sided page here, and a single figure can only ever show one side. A beam split by real proportion — what's out to your left, what you owe to your right, with a pivot that slides — answers "which way am I leaning" in the geometry, before you read either number.
- **Sadaka stopped looking like a KPI card.** Every other page is left-aligned and dense because every other page is about performance. Giving isn't, and a giving page that looks like a dashboard gets the tone exactly wrong. It centres now, drops its borders, and sits one figure in a soft pool of light with room around it.

## 1.6

Dead code and dead-end instructions.

- **The bell was asking "who is Got?" again.** A guard in the curiosity engine read *"only guess at names naively when there's no Gemini API key"* — and Gemini was removed in 1.0, which made that condition permanently true. So the naive capitalized-word guesser ran on every sweep even with a good local model loaded: exactly the behaviour the code's own comment claimed it prevented. It now checks whether a brain is actually available.
- **Three places told you to do something impossible** — "add your Gemini API key in Settings → AI" — a key the app no longer uses, in a tab that no longer exists. A dead-end instruction is worse than none.
- Removed the leftover Gemini key store, and the Personal-context explanation no longer names a threat model that isn't there any more.

## 1.5

Wallets, Loans, Projects and every sheet.

- **Wallets is a balance sheet.** It was a grid of equal boxes, which is the worst shape for a page whose only question is "how much is where" — a grid makes you compare figures that aren't aligned. Now one column sorted biggest first, each balance in a tabular figure with a share bar beneath it, led by the total.
- **Loans answers the actual question.** Two figures side by side never told you whether you're up or down overall. The page leads with your **net position**, then splits people into *They owe you* / *You owe them* / *Settled* — three different feelings that one alphabetical list buried.
- **Project columns carry money.** "Unpaid 2" tells you nothing: two unpaid projects could be ₱200 or ₱200,000, and knowing which is the entire reason to look at the board. Each column now shows its total — outstanding for the open columns, earned for Paid.
- **Every sheet got its header rebuilt.** A tinted glyph square, a title, and a filled ✕ on a grey bar was the last of the old visual language and the busiest 60 points in the app — two filled shapes competing before you'd read a word. Now an accent rule, the title in the editorial serif, and a plain close glyph. Field labels dropped a step so a form stops reading as a wall of equal text.

## 1.4

Spending and Insights actually restructured, not restyled.

- **Spending is two columns, and the right one does work.** It was four stacked cards — a hero, a category chart, a budgets card, and an undated list — where the chart and the budgets were both read-only. Now the ledger runs down the left **grouped by day with a running daily total**, and the category breakdown on the right is **interactive: tap a category and the ledger filters to it**. The single most common thing you want after seeing "Food ₱4,080" is to see which food, and there was no way to get there before.
- **Budgets folded into the categories.** A category with a cap now draws that cap into its own bar — ochre as it approaches, oxblood past it — instead of repeating every category name in a second card further down the page.
- **Insights leads with the chart.** Seven full-width cards of equal weight meant nothing was the answer to "how is the business doing". The trend chart now leads with the four supporting figures in a rail beside it, and the tables sit two-up instead of end to end.

## 1.3

Motion, depth, and the last of the badges.

- **The app moves now.** Figures tally up as they arrive rather than appearing fully formed, the balance line traces itself left to right with a soft glow under the stroke, sections rise and settle in sequence, and large panels carry a light that follows your pointer. All of it respects Reduce Motion, and none of it is decoration — a number counts because it's being totalled, a line draws because it's being traced.
- **The Dashboard has a lead, not a header.** The balance is set at 60pt with the chart bleeding across the full width behind it and light falling from the top-left corner, instead of a figure in a flat box with a chart underneath it.
- **The last tinted glyph squares are gone.** The weather banner was the final one — a coloured icon in a rounded square plus a full-card colour wash, sitting directly under the lead panel looking like a different product.
- **Observations stopped being badges.** Four rows each led by a differently-coloured icon turned a card of four sentences into a card of four logos, and every row carried a permanently-visible "⋯". The icons are gone, and pin/dismiss appear on hover.

## 1.2

Menus, copy, and the Dock icon — the details.

- **Menu items had no text.** Every menu built as `Button { … } label: { Label(…) }` rendered inside a macOS menu as a bare icon with no title, so "Add", "Wallet" and "Log payment" opened onto a column of unlabelled glyphs. That form is the culprit; all menu items now use the initializer that actually renders a title.
- **The stray chevron is gone.** `.borderlessButton` draws its own disclosure arrow, so every row's ⋯ was rendering as "⋯⌄" — an ellipsis wearing a second control.
- **The Dock icon finally updates.** The asset catalog was generating an .icns with only four representations, stopping at 256px. A Retina Dock asks for 512 and 1024, found nothing, and fell back to whatever it had cached — which is why the new icon never appeared no matter how many times it shipped. The app now carries a complete ten-representation icon file.
- **Menus say what things are.** "Routed payment (multi-hop)" → "One that passed through several wallets". "Bill or income (recurring)" → "Bill or income". "Loan" → "Money lent or borrowed".
- **Removed what nobody uses.** The card-density picker is gone from Wallets. The Clients "⋯" menu held exactly one item, so it's a button now — a menu with one item is two clicks for one action.
- **Page subtitles say what the page is for** rather than describing the implementation: "Money in and out, ledger-accurate" → "Everything that landed, and everything that left"; "Balances are derived from your ledger" → "Where your money sits right now".

## 1.1

Every screen, gone through one at a time.

- **One ledger, everywhere.** Payments, spends, bills, loans, sadaka and the agenda timeline now share a single row: a hairline mark in the semantic colour, the label, and the figure in tabular type at the end. Each screen used to draw its own — usually a 34pt filled colour circle in front and the amount set at the same size as its label, so the least informative thing on the row was the loudest and columns of numbers didn't line up.
- **Vendor logos stay.** They're the one mark that was actually information; the invented badges around them are gone.
- **Tiles lead with the number.** The tinted rounded-square icon in the corner of every tile is retired — a grid of a dozen of them is what made the app read as a template. The label is now a small-caps line and the figure is set in the editorial serif at nearly twice its old size. Values that are words rather than numbers drop to sans, so a vendor name stops arriving as a headline.
- **Client cards say one thing.** Earned, Outstanding and Projects were three equal columns shouting at the same volume. Now what they owe you leads, and the rest is one quiet line.
- **Project cards stopped repeating themselves.** Client colour was a spine AND a dot; overdue was a badge NEXT TO the status badge. One spine, one badge.
- **Primary buttons are one colour.** Nine different tints across nine screens read as nine apps.
- **Charts joined the palette** — the teal that predated this palette is gone from the cash-flow and income graphs.
- **The assistant button stopped covering things.** A 54pt orb was parked over the bottom-right corner of every page, on top of the Set budgets button and the income chart. It's a small capsule now that names itself on hover.
- **Body no longer looks like a warning.** The check-in card was washed in oxblood; the same applied to Sadaka's suggestion card. Depth comes from elevation, not a colour wash.
- Truncated tile labels fixed ("Landed this mo…", "Top client sha…"), and observations now de-duplicate on what they're ABOUT rather than their wording, so a rephrasing stops appearing as a second finding.

## 1.0

The first version I'd call finished. The intelligence was rebuilt from the ground up, the app has a new identity, and the parts that were quietly making things up have been taken out.

### The AI no longer invents things about you

- **Observations are computed, not written.** Everything in "What Freelane noticed" is now arithmetic over your own rows — a comparison you could check by hand. No language model decides what's true about your money or your life any more. It used to, and it produced sentences like *"your gifting pattern is designed to preemptively manage relationship friction, not genuine generosity"* — fluent, confident, and entirely invented. Two rounds of stricter instructions didn't stop it, so the model lost the job. The 84 fabricated ones already in your app are cleared on update.
- **It can't leak internal ids into questions.** "What would make the next step feel good, like the 1000 euro contract from journal_1784966887??" happened because memories were keyed by timestamp and the key was being shown to the model. Nothing outside the memory layer ever sees a key now, and no question ships without passing a single strict gate — the old lenient fallback path is gone, which is how the double question mark got through.
- **Corrections actually correct.** Telling it "I never sold a motorbike" used to file that sentence as one more belief beside the claim it was refuting, so it held both and kept asking. A correction now deletes what it contradicts, including an older correction on the same subject. Your 253 stored beliefs were rebuilt: guesses retired, what you confirmed kept, your corrections replayed oldest-first so the most recent thing you said wins.
- **You can see and delete everything it believes.** Settings → Intelligence lists every belief, where it came from, and a bin next to each one.
- **Questions can't come back malformed.** Every structured AI call now decodes against a fixed schema, so a wrong category or a truncated reply is impossible rather than merely discouraged. That class of bug — where a bad reply silently rendered an empty box — is what "things don't load and it breaks" was.
- **Questions are written one at a time.** The old batch prompt carried your entire history and blew the context window, which is why "New questions" failed most of the time. Each question now gets its own small prompt, and a failure costs one question instead of all of them. When nothing can be added, it tells you why and which brain was asked.

### A local model that's actually yours

- **Qwen3-8B runs inside Freelane, on your Mac.** About 4.6 GB, downloaded once from Settings → Intelligence, loaded straight onto the GPU. No Ollama, no server, no second app. Once it's down, the AI works with the internet off.
- **Apple's Private Cloud Compute is off.** It's wired up, but on this macOS build it reports itself available and then fails every call — four attempts, four errors, zero successes. A new circuit breaker drops any brain that fails repeatedly without ever succeeding, so a dead one can't sit at the head of the queue burning every request or spam you about it.
- **Superseded weights are deleted automatically.** Changing models never leaves two multi-gigabyte copies on disk.
- **Interrupted downloads resume** on next launch instead of leaving the app brainless with half a file.

### A new look, and one less thing to feel bad about

- **New palette and new icon.** Warm-neutral ink instead of the muddy brown, one forest-green accent, and a serif for headlines and hero figures so the app reads like a page rather than a dashboard. The mark no longer inverts with the theme — a logo is a constant. There's a light theme in Settings, retuned to warm grey rather than the paper white that was genuinely painful to look at.
- **The journal streak is gone.** The whole system — streaks, coins, freezes, recovery, and the calendar marking every day you missed in red. It turned journalling into a daily obligation and made a busy day feel like a failure, which is the opposite of the point. Days you wrote still show; days you didn't are simply blank.
- **Open questions read like invitations.** Larger serif type, room to breathe, and the housekeeping controls stay out of the way until you're on a question.
- **The page stopped shimmering.** The animated background was re-rendering continuously for the whole life of the app to make glass refract against something. The cards aren't glass any more, so it bought nothing but heat.

## 0.20

Talk back to it — your answers now teach it directly.

- **Say "don't ask about this again" inside an answer and it listens.** Writing "stop asking", "I'm not interested in this", or "I never did this" in a journal answer now burns that topic exactly like the ✕/👎 buttons — the explicit phrases are matched directly (never left to the model's judgment), and softer pushback is picked up by the analysis.
- **Correct it, and its memory updates.** Write "actually, I live in Manila now" or "I never had a motorbike" in any answer and the corrected fact is stored in your own words at near-certainty — while old inferred beliefs it contradicts are archived. Your words always outrank what it guessed.

## 0.19

Questions that are actually about you — two real bugs, fixed at the root.

- **Why "New questions" kept failing:** the app was feeding the model your entire ask-history — over a hundred past questions — plus everything else, which blew past the on-device model's context limit, so generation simply died. The prompt now carries only the recent history (deep-archive repetition was already blocked mechanically), and if a batch still fails, a slimmer retry runs before the button ever gives up. When nothing can be added, the button now says *why* instead of doing nothing.
- **Why it invented things like a "singing contest":** the personal-context digest treated things you'd *read about* in Safari as things you *do* — one stray article became "practicing for a singing competition." The digest was rebuilt: what you did (messages, calendar, reminders) and what you merely looked at are now separate, browsing can never be asserted as your life, junk "search terms" from non-search sites are ignored (that's where the phantom topics came from), and garbage contact fragments can't be recorded as people.
- **You can now see what it thinks.** Settings → Integrations → Personal context shows the current digest — life threads, reading topics, people — with a "Refresh now" button. If a question ever feels off, you can see exactly where it came from.
- The old bad digest is discarded automatically on update.

## 0.18

The AI now knows your life, and Siri now knows Freelane.

- **Personal context (opt-in).** Settings → Integrations grew a "Personal context" card: let the AI read your **Messages**, **Safari history & searches**, and **Calendar** (plus Reminders if already on). Once a day, the on-device model digests them into themes — "apartment hunting", "in touch with Sarah a lot", "flight on the 24th" — and journal questions, insights, and chat quietly become aware of your actual life. Signals, not quotes: message text is never stored and never quoted back at you.
- **Privacy, hard-gated.** Every source is off by default. The digest is produced by the on-device model directly and can only ever ride on-device prompts — even if you enable the Gemini cloud fallback, this content is excluded from anything that could leave the Mac. Messages and Safari need Full Disk Access (the card walks you there).
- **Siri can drive the app.** Freelane's projects, clients, and wallets are now registered in the system's semantic index, so the new Siri can find and open them by name — "open Acme in Freelane" lands directly on that client — alongside the existing voice actions (log a spend, safe-to-spend, log a payment, and more).

## 0.17

Journal questions, fixed and rethought.

- **The "…" questions are gone — and can't come back.** The new on-device model copied the example format from our instructions literally, so three questions whose entire text was "…" reached your Journal. Every AI reply that gets stored now passes a real-content check, the instruction templates no longer contain copyable placeholders, and the app cleans out any junk that slipped in (your "…" rows disappear on first launch).
- **Questions are simple and human now.** The generator was rebuilt: every question is under 15 words, one idea, plain spoken language — "What's been weighing on your wallet this month?" instead of a two-clause poem about what your kitchen says about your soul. Poetic or double-barreled output is rejected before you ever see it.
- **Less repetition, by design.** Each batch draws from different territories (feelings, work, money, people, faith, the future, body, small joys) than the last batch — rotation is enforced in code, so it can't keep circling the same two topics no matter what you wrote about. Follow-up questions obey the same style rules.

## 0.16

Built for macOS 27 "Golden Gate" — and one brain instead of three.

- **Apple's new on-device model is now the app's main brain.** macOS 27's rebuilt foundation model tested faster (1–3s) and smarter than the local Gemma it replaces — so the whole Ollama/Gemma layer is gone: no separate install, no 10GB model on disk, no RAM governor, one less thing in Settings. Everything — tagging, insights, questions, chat — runs on-device, private, offline. Gemini remains strictly opt-in, as before.
- Two hardenings from actually testing the new model with the app's real prompts: JSON replies that come back malformed are retried once with strict instructions (so insights never silently fail), and the "who is this person?" question can never be triggered by a relationship word — the model once answered "wife" as a person's name; the app now knows better.
- **The app now requires macOS 27** and is built against the new SDK, so it wears Golden Gate's refined Liquid Glass automatically — better content diffusion, the new edge treatment, and it respects the system-wide transparency slider on the nav layer.
- **Dashboard tile reordering is native now** — rebuilt on macOS 27's new reorder API, so dragging tiles gets the system's pickup and settle animations instead of our old hand-rolled drop logic.
- Updates are back: this release is on GitHub again, so "Check for Updates…" works from here on.

## 0.15

The big one — five real money-logic fixes, and the app finally acts on what it knows.

**The number you trust is now honest:**
- **A big purchase no longer wrecks your day.** Safe-to-spend excluded one-offs and investments from your allowance but still counted them against it — log a ₱30k laptop and the app screamed "overspent." Now only everyday spending burns the day down (the "Spent today" tile still shows the real total).
- **Money landing today counts today.** The day's allowance used to freeze at dawn clamped to your morning wallet cash — a ₱50k payment at noon changed nothing. Now the frozen part is only your spending pace; wallet reality applies live, so income lifts the day back up (never above your pace).
- Fixed a silent drift where editing a payment's net didn't update its chain step (would have made the future Android app disagree with the Mac by the corrected amount), a missing sync flag on learned bill amounts, and loans that could read "All settled" while showing an open loan you couldn't close.

**The app now helps you act:**
- **"Acme owes ₱40k · 34 days" on the Dashboard.** The #1 thing a freelancer opens the app for is now a Needs-you signal that opens straight into that client — where the AI nudge-drafter lives.
- **Pay bills where you see them.** Due bills now have a Pay button on the Agenda and right inside the bell notification — no more "go to Spending → Recurring."
- **Budgets.** Give any category a monthly cap: a quiet progress bar in Spending (amber at 80%, red when over) and a Dashboard signal when one blows through.
- **Savings goals are back.** Set a target and a monthly set-aside on the Agenda; the set-aside is reserved out of safe-to-spend like a bill, with months-to-go estimated.
- **A month-end ritual.** On your first open of a new month: "June, closed — landed X, spent Y, net +Z, income +12% vs May, most on food, fees took ₱800."
- **Capture in one keystroke.** ⌃⌥Space (quick spend from anywhere) is now on by default, and ⌘K's "Log a spend / payment" opens the sheet directly instead of just navigating.
- The AI's mind × money read now includes your body check-ins — mood, energy, sleep, and workouts against your spending. Your city is now settable in Settings, so cost-of-living anchoring is actually yours. First launch now leads with "add your first wallet" instead of ₱0 tiles you can't do anything with.

**And the polish:**
- Content centers in wide windows (no more dead right gutter), the cursor becomes a pointer over everything clickable, dashboard tiles dropped the 7-color rainbow for the one amber identity (color now only means something), warning-orange is reserved for actual warnings, heavy shadows and glows are tuned for light mode, key numbers on tiles got bigger, Spending got a real hero ("spent this month" + 6-month shape + delta), and the last stray half-point font sizes are gone.

## 0.14

Structure — a tighter map and real keyboard muscle memory.

- **Stats and Activity are now one page: Insights.** The month/year/lifetime business read and the day-by-day activity trail were both "look back at what happened" — now they're subtabs of a single sidebar destination (Activity's filters, search, and Trash all came along). One less sidebar row.
- **⌘1…⌘9 jump straight to any sidebar page** in order, and **⌘, opens Settings** like every Mac app. The ⌘? cheat sheet now tells the whole truth — it gained ⌘N (log spend), ⌘⇧N (log payment), and the new jumps, and stopped claiming things that didn't work.
- **Wallets finally greets you.** With no wallets it now explains what wallets are and offers the add button — instead of a lonely ₱0 over a blank grid.
- **The Qur'an reader matches the app now** — the warm backdrop, entrance animation, click-outside and Esc to close, instead of the flat dark panel it's been since v0.1.

## 0.13

Feel — the app responds to your hand now.

- **Transaction rows are alive.** Spends, payments, transfers, and loan people now highlight under the cursor and open with a **click anywhere on the row** — no more hunting for the hidden ⋯ menu (it's still there for delete).
- **Kanban that never drops the ball.** Miss a column and the card **springs back to its slot** instead of vanishing mid-air; a gentle pickup spring when the drag starts; dragging near the board's edge **auto-scrolls** toward off-screen columns; and the whole board no longer re-renders on every mouse move while dragging (only the floating card does).
- **Sheets respond instantly.** The first field focuses the moment a sheet opens (there was a 0.3-second dead zone where typing went nowhere), and adding/removing payment rows and the "arrived together" panel now slide in instead of popping.
- **Search (⌘F) got arrow keys.** ↑↓ move the highlight, ⏎ opens it — same as ⌘K, at last.
- **One motion language.** Every animation in the app now comes from the same six named springs — page turns, card entrances, presses, toasts. Nothing bounces one way on one screen and another way on the next.
- Tappable cards (wallets, clients) now lift slightly on hover, like the dashboard tiles always did.

## 0.12

Coherence — the whole app now speaks one visual language.

- **Light mode actually works everywhere now.** Text fields, sheet headers and footers, the selected tab pill, chart crosshairs, the heatmap, the qibla dial — dozens of controls were still painted for a dark room and went nearly invisible on the warm-paper theme. All of them now adapt properly to light and dark.
- **One selected-state look.** The in-page tab bar now uses the same amber pill as every other segmented control, instead of its own washed-out white one.
- **Machined corners.** Cards shipped at seven different corner radii (13–24). Now there are exactly two — compact tiles at 16, section cards at 20 — so screens read as one machined surface instead of assembled parts.
- **Calmer cards.** The glowing colored dot on every card title is gone (Stats alone flashed five different colors), and icon-chip glows are toned down. Color now means something: money states and the amber signature — section identity stays in the sidebar where it belongs.
- **The last glass box is gone.** The cash-flow hover tooltip was the one remaining frosted-glass element in the content layer; it's now a solid grounded card like everything else.
- Evened out type drift (a dozen controls used odd half-point sizes).

## 0.11

Projects drag-and-drop, now with real physics.

- **A card that feels physical.** Dragging a project card now lifts it into a floating ghost that **tilts with your drag speed**, scales and casts a deeper shadow the faster you move, and springs to follow the cursor — instead of the flat native drag.
- **Columns react.** The column under your card lights up and lifts as you hover it, so it's obvious where the card will land. Drop it and it settles into place.
- Tap a card to edit, drag it to move — the two never get confused.

## 0.10

Loans that finally make sense — record a return in one tap.

- **One "Record return" button per person.** Enter how much they paid you back and it's applied to your **oldest loan first** (even partially), spilling across loans as needed. You never pick which specific loan — a person's debt is treated as one pool, the way you actually think about it.
- **A persistent history.** Every lend and every repayment for a person now lives in one unified timeline that always stays visible, instead of being scattered across separate loan cards.
- Individual loans are still there for edits, forgiving, or corrections — just tucked below the history.

## 0.9

A leaner sidebar — only the things you actually use.

- **Removed the clutter:** People, Vendors, Faith, and the standalone Today page are gone from the sidebar (their data is kept, nothing is deleted). Today's useful parts — safe-to-spend and runway — already live on the Dashboard.
- **Clients moved into Money**, where it belongs.
- Search and ⌘K no longer surface the removed pages; a vendor search now takes you to Spending.

Next: a much easier way to record loan returns, and a physics-based drag for Projects.

## 0.8

Light mode — and a calmer, grounded look with less glass.

- **Warm light mode.** A proper warm-paper light theme to go with the warm dark. Switch it in Settings → General → Appearance: **Light / Dark / System** — it flips instantly, no relaunch.
- **Less glass, more grounded.** Content cards are now solid matte panels with a hairline edge and a soft shadow, instead of glossy glass boxes. Real Liquid Glass is kept where Apple uses it — the floating nav, the bell, the assistant pill — not on every card.

## 0.7

A warmer look with real depth — and the app icon finally matches.

- **Warm dark.** Out with the cold slate-and-blue, in with cozy warm-charcoal surfaces, warm-cream text, and a single amber signature. Dark, but inviting instead of clinical.
- **Depth, not flatness.** Cards now sit on a solid surface that lifts off the background with a stronger edge and shadow, so the screen stops reading as one flat sheet of same-colored panels.
- **The icon matches now.** The app icon and the in-app logo were redrawn to the new warm-amber identity (they were still the old design).
- **Fixed a nonsense alert.** "Wise is ₱0 overdrawn" is gone — a wallet only flags as overdrawn when it's *meaningfully* in the red, and it shows the real amount.

Next: a proper light/white mode you can toggle.

## 0.6

- Cloud sync stays off for now. The offline-first sync foundation is built and ready, but it's dormant until the companion app exists — so Freelane is purely local again: everything lives on this Mac, nothing touches the network, and there's no cloud setup to think about.

## 0.5

Smarter spending — your vendors now show you where the money's moving.

- **Vendor trends.** Each vendor in the Vendors list now shows a month-over-month pill — ↑ in coral when you're spending more there than last month, ↓ in mint when less (only real moves of 10%+ show, so it stays quiet).
- **Biggest mover on the home screen.** The Dashboard surfaces your single biggest vendor swing as a tile ("Spending up at Jollibee · 40% vs last month") that taps straight through to Vendors — the first of several screens that now talk to each other.

## 0.4

Offline-first cloud sync — your data, on this Mac and in your own private cloud.

- **Works fully offline.** Everything lives on this Mac first, so you can log spends and payments with no connection; changes queue up and sync automatically the moment you're back online.
- **Automatic sync.** Freelane now restores your cloud session on launch and syncs on its own — when the app opens, when it comes to the foreground, and the instant the network returns — instead of only when you ask.
- **Spends now sync up.** A spend you log offline (or on another device) now actually reaches the cloud — previously spends only came down, never went up.
- **A real Cloud tab in Settings.** Connect to your private Supabase, see live sync status and last-synced time, sync on demand, or disconnect. Your password is never stored — only a Keychain refresh token.
- **Live sync status in the sidebar.** The corner chip now shows whether you're synced, offline (saved locally), or local-only — tap it to jump to cloud settings.

This is the groundwork for a future companion app: one private cloud, with each device working offline and reconciling when online.

## 0.3

The start of a v2 rethink — a brand-new look and a smarter home.

- **New identity: Nordic slate + electric.** The whole app moves off espresso-and-gold to a cool graphite/slate palette with a single electric-blue signature, crisp near-white text, and clean sans headers. Sharp, modern, calmer to live in.
- **Section identity.** Each sidebar area now owns an accent — Money is mint, People periwinkle, Life orchid, Insights ice, Overview electric — with a colored dot per group, so you always know where you are at a glance.
- **A home that pulls the right thing forward.** The Dashboard now leads with a "Needs you" surface that surfaces only what actually wants a tap (an overdrawn wallet, overdue projects, overspending, an evening prayer nudge), ranked by urgency. When nothing needs you, it steps aside for a calm overview.
- **Smoother.** Page navigation is one consistent motion everywhere (it used to mix three), the old double-animation jank on page swaps is gone, and hovering the cash-flow chart no longer re-runs the money engine — so the busiest screen stays fluid.
- Hardened the app's data-folder lookup so launch can't crash on an edge case.

## 0.2

- A first tiny update to try out in-app updating — the About screen now notes that updates come straight from GitHub.

## 0.1

First public build of the native macOS app.

- Money core: payments as fee-aware chains, wallets/withdrawals on a single ledger, projects, spending, loans, stats, activity, dashboard, today.
- People: clients, entities, vendors with price memory. Life: journal, prayer times + qibla + Quran, body, sadaka. Intelligence: grounded AI chat + curiosity engine.
- In-app updates via Sparkle — check from Settings → About or Freelane ▸ Check for Updates….
- Fixes: zero / near-zero wallet balances no longer render as negative (red); a spend stays on the wallet you picked instead of flipping to Cash on save; loans are grouped into one card per person with the full lend/repay history; the AI stops re-asking questions you've dismissed (and no longer treats a tricycle as a person); AI insights are much shorter.
