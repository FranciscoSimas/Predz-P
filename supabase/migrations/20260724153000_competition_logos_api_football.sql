-- Point competition logos at API-Football CDN (media.api-sports.io),
-- replacing Sofascore / football-data.org leftovers after the Pro cutover.

UPDATE public.competitions
SET logo_url = 'https://media.api-sports.io/football/leagues/' || external_id || '.png'
WHERE external_provider = 'api-football'
  AND external_id ~ '^[0-9]+$'
  AND (
    logo_url IS NULL
    OR logo_url LIKE '%sofascore%'
    OR logo_url LIKE '%football-data.org%'
    OR logo_url NOT LIKE 'https://media.api-sports.io/football/leagues/%'
  );
