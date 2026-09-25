package main

import "testing"

func TestCountLeagueGoalsFromEvents(t *testing.T) {
	t.Parallel()
	goal := func(id int, detail string) afFixtureEvent {
		var ev afFixtureEvent
		ev.Type = "Goal"
		ev.Detail = detail
		ev.Player.ID = id
		ev.Player.Name = "x"
		return ev
	}
	card := afFixtureEvent{Type: "Card", Detail: "Yellow Card"}
	card.Player.ID = 36798
	events := []afFixtureEvent{
		goal(36798, "Normal Goal"),
		goal(36798, "Penalty"),
		goal(1, "Own Goal"),
		goal(36798, "Missed Penalty"),
		card,
	}
	got := countLeagueGoalsFromEvents(events)
	if got[36798] != 2 {
		t.Fatalf("Pavlidis goals = %d, want 2", got[36798])
	}
	if _, ok := got[1]; ok {
		t.Fatalf("own goal counted: %v", got)
	}
}
