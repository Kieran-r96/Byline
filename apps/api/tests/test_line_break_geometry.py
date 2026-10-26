"""Every "Line-breaking pass" must break a line in the tracking frame, not just carry the detector's label."""

from __future__ import annotations

from fastapi.testclient import TestClient

from byline.api.app import app


def test_every_line_breaking_pass_crosses_a_measured_defending_line() -> None:
    checked = 0
    with TestClient(app) as c:
        for match in c.get("/api/matches").json():
            mid = match["match_id"]
            for t in c.get(f"/api/matches/{mid}/tactics").json():
                if t["kind"] != "line_break":
                    continue
                v = c.get(f"/api/matches/{mid}/tactics/{t['moment_id']}/view").json()
                sign = 1 if v["direction"] == "+x" else -1
                arrow = next(a for a in v["arrows"] if a["type"].startswith("pass"))
                sx, ex = arrow["from"][0] * sign, arrow["to"][0] * sign
                lines = [v["lines"][k] * sign for k in ("back_x", "mid_x") if v["lines"][k] is not None]
                assert any(sx < x < ex for x in lines), f"{mid} {t['moment_id']} crosses no measured line"
                defenders = [p for p in v["players"] if p["team_id"] == v["defending_team_id"] and not p.get("gk")]
                between = sum(1 for p in defenders if sx < p["x"] * sign < ex)
                claim = next(o["value"] for o in v["observed"] if o["label"] == "Opponents bypassed")
                assert abs(claim - between) <= 1, f"{mid} {t['moment_id']}: claims {claim}, geometry {between}"
                checked += 1
    assert checked >= 40
