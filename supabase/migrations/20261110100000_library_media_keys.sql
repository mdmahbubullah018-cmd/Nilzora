-- ---------------------------------------------------------------------------
-- Library pictures in image fields
--
-- The store-profile logo and sharing image, product and category sharing (SEO) images
-- and onboarding slides may now also store a media-library key (`library/<asset id>`).
-- Each check keeps exactly the folders it accepted before and adds `library`; the
-- length limits are unchanged. Every existing value satisfies the wider check.
-- ---------------------------------------------------------------------------

alter table public.store_profile
  drop constraint store_profile_logo_key_check,
  add constraint store_profile_logo_key_check
    check (logo_key is null or logo_key ~ '^(brand|seo|library)/[A-Za-z0-9/_-]{1,160}$');

alter table public.store_profile
  drop constraint store_profile_og_image_key_check,
  add constraint store_profile_og_image_key_check
    check (og_image_key is null or og_image_key ~ '^(brand|seo|library)/[A-Za-z0-9/_-]{1,160}$');

alter table public.products
  drop constraint products_og_image_key_check,
  add constraint products_og_image_key_check
    check (og_image_key is null
           or og_image_key ~ '^(products|categories|seo|library)/[A-Za-z0-9/_-]{1,160}$');

alter table public.categories
  drop constraint categories_og_image_key_check,
  add constraint categories_og_image_key_check
    check (og_image_key is null
           or og_image_key ~ '^(products|categories|seo|library)/[A-Za-z0-9/_-]{1,160}$');

alter table public.onboarding_slides
  drop constraint onboarding_slides_image_key_check,
  add constraint onboarding_slides_image_key_check
    check (image_key is null
           or image_key ~ '^(products|categories|seo|brand|library)/[A-Za-z0-9/_-]{1,172}$');
