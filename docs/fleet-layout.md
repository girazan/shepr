# Fleet layout

How the fleet is arranged above the pane: which workspace holds it, which tab, and
what the pane label is therefore free not to say.

This is a convention, not code. herdr owns geometry — nothing in shepr creates a
workspace or moves a pane. It is written down so that a coordinator started from a
handoff with no memory lays the fleet out the same way as the one it replaced, and
so that the Director can find a milestone's work without remembering a generated
identifier like `w21`.

The pane-name grammar itself lives in `skills/go/delegate.md` ("Pane names") and is
not restated here.

## Workspace

    M<n> - <Repo>

A workspace whose name carries a milestone prefix is a **fleet workspace**: it holds
supervised work for that milestone against that repository. A workspace named for a
repository with **no** milestone prefix holds that repository's non-fleet work —
strategy, grill sessions, scratch. The prefix is the whole signal; one glance
separates the two.

`<Repo>` is the repository name **on GitHub**, not the local directory name, because
a local directory name goes stale and nothing corrects it. The working example: the
folder `i-start-ots` holds the repository `pertasim`, so its fleet workspace is
`M1 - Pertasim`.

shepr's own development sits in a workspace of its own, so plugin work is never
confused with the work the plugin supervises.

## Tab

Inside a fleet workspace, the coordinator sits on its own tab and its lanes sit on
another. A coordinator **serves** a milestone rather than living inside one, so the
Director can reach it without scanning past the lanes it drives — and a coordinator
that is re-scoped to a different milestone moves workspace rather than leaving the
hierarchy quietly lying.

## Pane

The pane label carries goal and step only. It never repeats the milestone: the
workspace already carries it, and goal identifiers are GitHub issue numbers, so they
are globally unique with or without a milestone in front of them.
