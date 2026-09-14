-- Migration to make match_events sequence number assignment concurrency-safe
CREATE OR REPLACE FUNCTION public.assign_match_event_sequence_number()
RETURNS trigger AS $$
DECLARE
  next_seq integer;
BEGIN
  -- Lock the matches row to serialize concurrent inserts on the same match
  PERFORM 1 FROM public.matches WHERE id = NEW.match_id FOR UPDATE;

  -- Calculate the next sequence number (COALESCE handles the first event where max is null)
  SELECT COALESCE(MAX(sequence_number), 0) + 1
  INTO next_seq
  FROM public.match_events
  WHERE match_id = NEW.match_id;

  -- Overwrite NEW.sequence_number with the safely-calculated value
  NEW.sequence_number := next_seq;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assign_match_event_sequence_number_trigger ON public.match_events;
CREATE TRIGGER assign_match_event_sequence_number_trigger
  BEFORE INSERT ON public.match_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.assign_match_event_sequence_number();
