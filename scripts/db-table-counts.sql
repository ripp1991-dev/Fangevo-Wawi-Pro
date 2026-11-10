-- Exakte Zeilenzahl je Tabelle im Schema public, Format: tabelle|anzahl
-- Benötigt eine Rolle, die RLS umgeht (fangevo_backup oder Administrator), sonst sind die Zahlen zu klein.
SELECT c.relname || '|' ||
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;
