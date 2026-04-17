# Design Guide

This file describes the actual visual system used by T3 Code. Treat it as the source of truth for UI, layout, motion, and visual tone.

## Design Summary

T3 Code is not a marketing site. It is a dense, operational tool for working with coding agents.

The current aesthetic is:

- functional first
- quiet, precise, and slightly polished
- neutral surfaces with restrained accents
- subtle depth instead of heavy decoration
- app-like rather than “SaaS landing page” style

When adding UI, preserve that feel. The interface should look intentional and calm under load, not flashy.

## Visual Character

The app uses a balanced, modern desktop-product look:

- light and dark themes are both first-class
- panels use soft borders, subtle shadows, and modest rounding
- backgrounds are usually flat or near-flat, with only light texture or atmospheric gradients in special surfaces
- accent color is a muted blue family for primary actions and focus
- status colors are limited to success, info, warning, and destructive

The app should feel like a serious control surface for coding sessions, not a consumer dashboard.

## Typography

Current typography choices are deliberately modest:

- body text uses `DM Sans`
- code and terminal surfaces use `SF Mono`, `SFMono-Regular`, `Consolas`, `Liberation Mono`, `Menlo`, monospace

Guidelines:

- use compact, readable type scales
- keep headings short and direct
- prefer weight and spacing changes over elaborate font changes
- use uppercase micro-labels sparingly for section headers and metadata

Avoid:

- decorative display fonts
- large marketing-style headlines
- generic “AI product” typography stacks that feel interchangeable

## Color System

The palette is token-driven in [`apps/web/src/index.css`](./apps/web/src/index.css).

Core points:

- `background`, `card`, `popover`, `foreground`, `muted`, `accent`, `border`, and `input` are the main surfaces and interaction colors
- the primary accent is blue-based in both themes
- light theme is mostly white and neutral gray with low-contrast borders
- dark theme is near-black with slightly lifted panels
- semantic colors are reserved for actual state, not decoration

Design rules:

- do not introduce strong new brand colors unless the feature genuinely needs them
- keep component contrast predictable in both themes
- prefer token usage over one-off arbitrary colors

## Surface And Depth

The UI uses layered but restrained depth:

- cards and sheets use soft borders and small shadows
- the auth/pairing surfaces use atmospheric radial gradients and a subtle linear wash
- the app shell uses strong structure through layout, not visual clutter
- noise texture is very subtle and only used globally as a tactile overlay

Use depth to clarify hierarchy, not to decorate every box.

## Layout Principles

The main layout is a workbench:

- persistent sidebar on the left
- chat and thread workspace in the center
- supporting controls live in the header and right-side or drawer surfaces
- empty states and auth surfaces are centered and contained

Rules:

- prioritize density and scannability
- keep interactive regions obvious and compact
- allow the sidebar and header to carry global navigation
- avoid introducing large unused whitespace unless the screen is intentionally an empty state

## Component Language

The UI consistently uses small, composable primitives:

- buttons, toggles, badges, alerts, dialogs, tooltips, menus, sheets, inputs
- compact pills for status and metadata
- drawers and sheets for supplemental content
- toast surfaces for transient feedback

When creating new UI:

- reuse existing primitives when possible
- keep new controls visually consistent with the current ones
- prefer inline actions and compact control clusters

## Motion

Motion is subtle and functional:

- sidebar list movement uses short, ease-out animation
- toasts animate in and out with staged vertical stacking
- auth and shell bootstrap transitions are minimal
- use motion to clarify state changes, not to draw attention to the UI itself

Rules:

- keep animation durations short
- avoid constant motion or ornamental looping
- favor one clean transition over many small effects

## Shell And Chrome

The app must work cleanly inside a desktop shell:

- Electron window controls may be present
- the drag region is explicit in the CSS and must be preserved
- mobile and browser layouts should still behave predictably

Be careful with:

- pointer events inside drag regions
- resizing sidebars and drawers
- viewport height assumptions

## Auth And Pairing Screens

The auth screens have a specific visual identity:

- centered card on a soft atmospheric background
- small uppercase product label
- clear headline
- concise explanatory copy
- one primary action and one recovery action

The pairing flow should feel reassuring and technical, not promotional.

## Chat And Workspace Tone

The chat workspace is practical and information-dense:

- thread title and project chips are compact
- git, terminal, and diff controls are nearby and obvious
- banners indicate provider or thread issues without dominating the screen
- the empty thread state is calm and direct

The view should communicate “this is a live operational session” rather than “this is a messaging app.”

## Don’t Do These

- do not use generic SaaS gradients or purple-on-white patterns
- do not default to Inter/Roboto/system without a reason
- do not add ornamental animation that does not carry meaning
- do not overuse glassmorphism or heavy blur
- do not turn operational screens into hero sections
- do not add visual density without a functional reason

## File References

The main sources for this design system are:

- [`apps/web/src/index.css`](./apps/web/src/index.css)
- [`apps/web/src/routes/__root.tsx`](./apps/web/src/routes/__root.tsx)
- [`apps/web/src/components/AppSidebarLayout.tsx`](./apps/web/src/components/AppSidebarLayout.tsx)
- [`apps/web/src/components/Sidebar.tsx`](./apps/web/src/components/Sidebar.tsx)
- [`apps/web/src/components/chat/ChatHeader.tsx`](./apps/web/src/components/chat/ChatHeader.tsx)
- [`apps/web/src/components/NoActiveThreadState.tsx`](./apps/web/src/components/NoActiveThreadState.tsx)
- [`apps/web/src/components/auth/PairingRouteSurface.tsx`](./apps/web/src/components/auth/PairingRouteSurface.tsx)

## Practical Rule

If you are unsure how a new screen should look, match the existing app shell:

- restrained surfaces
- compact controls
- calm empty states
- small, meaningful accents
- utility over spectacle
