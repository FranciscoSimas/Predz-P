-- Cutover: active competitions → API-Football Pro league ids (season 26/27 → 2026)
UPDATE public.competitions SET
  external_provider = 'api-football',
  external_id = CASE slug
    WHEN 'liga-portugal-26-27' THEN '94'
    WHEN 'premier-league-26-27' THEN '39'
    WHEN 'bundesliga-26-27' THEN '78'
    WHEN 'serie-a-26-27' THEN '135'
    WHEN 'la-liga-26-27' THEN '140'
    WHEN 'ligue-1-26-27' THEN '61'
    WHEN 'championship-26-27' THEN '40'
    WHEN 'eredivisie-26-27' THEN '88'
    WHEN 'brasileirao-26-27' THEN '71'
    WHEN 'champions-league-26-27' THEN '2'
    WHEN 'europa-league-26-27' THEN '3'
    ELSE external_id
  END
WHERE is_active = true
  AND slug IN (
    'liga-portugal-26-27',
    'premier-league-26-27',
    'bundesliga-26-27',
    'serie-a-26-27',
    'la-liga-26-27',
    'ligue-1-26-27',
    'championship-26-27',
    'eredivisie-26-27',
    'brasileirao-26-27',
    'champions-league-26-27',
    'europa-league-26-27'
  );
