/*
 * Shared classes for controls inside the site header. The header carries `group/header` and a
 * `data-solid` attribute: transparent (white content) over the home banner, solid (navy content
 * on a frosted white bar) once scrolled or on any other page.
 */

/** A 44px round icon control: menu, search, account and cart. */
export const headerIconButton =
  'relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full transition-[background-color,scale] duration-300 hover:bg-white/10 active:scale-95 motion-reduce:transition-none group-data-[solid=true]/header:hover:bg-surface-muted max-lg:hover:bg-primary/8';
