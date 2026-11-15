#!/usr/bin/env python3
"""Offline tests for jev-skill-router.py. The Jev call is stubbed; nothing touches the network."""
import importlib.util, io, json, os, tempfile, unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("router", HERE / "jev-skill-router.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

SKILLS = {
    "pptx": "Create and edit slide decks, presentations, pitch decks and slides",
    "dbtool": "Run database migrations and schema changes for postgres",
}
PROMPT = "make a slide deck summarising the quarterly results"


def reply(probs):
    body = {"answers": {f"s{i}": {"noul": p} for i, p in enumerate(probs)}, "usage": {"input_tokens": 5}}
    resp = mock.MagicMock()
    resp.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
    return resp


class Router(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        for k in ("TYPESAFE_API_KEY", "CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY", "CLAUDE_PLUGIN_DATA"):
            os.environ.pop(k, None)
        self.addCleanup(self.env.stop)

    def test_no_key_does_nothing_and_makes_no_call(self):
        with mock.patch.object(r.urllib.request, "urlopen") as call:
            self.assertEqual(r.route(PROMPT, None, SKILLS), [])
        call.assert_not_called()

    def test_key_from_plugin_setting_or_environment(self):
        os.environ["TYPESAFE_API_KEY"] = "env-key"
        self.assertEqual(r.api_key(), "env-key")
        os.environ["CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY"] = "setting-key"
        self.assertEqual(r.api_key(), "setting-key")

    def test_never_reads_a_dotenv_file(self):
        with tempfile.TemporaryDirectory() as home:
            (Path(home) / ".env").write_text("TYPESAFE_API_KEY=from-file\n")
            with mock.patch.object(r, "HOME", Path(home)):
                self.assertIsNone(r.api_key())

    def test_picks_above_threshold_are_returned_best_first(self):
        os.environ["TYPESAFE_API_KEY"] = "k"
        cands = r.prefilter(PROMPT, SKILLS)
        probs = [0.9 if c == "pptx" else 0.1 for c in cands]
        with mock.patch.object(r.urllib.request, "urlopen", return_value=reply(probs)) as call:
            picks = r.route(PROMPT, None, SKILLS)
        self.assertEqual(picks, [(0.9, "pptx")])
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args[0][0].full_url, "https://api.typesafe.ai/v1/systemone")

    def test_slash_commands_and_short_prompts_are_not_sent(self):
        os.environ["TYPESAFE_API_KEY"] = "k"
        with mock.patch.object(r.urllib.request, "urlopen") as call:
            self.assertEqual(r.route("/help me please now", None, SKILLS), [])
            self.assertEqual(r.route("fix it", None, SKILLS), [])
        call.assert_not_called()

    def test_usage_log_goes_to_plugin_data_without_the_prompt(self):
        os.environ["TYPESAFE_API_KEY"] = "k"
        with tempfile.TemporaryDirectory() as data:
            os.environ["CLAUDE_PLUGIN_DATA"] = data
            cands = r.prefilter(PROMPT, SKILLS)
            with mock.patch.object(r.urllib.request, "urlopen", return_value=reply([0.1] * len(cands))):
                r.route(PROMPT, None, SKILLS)
            log = (Path(data) / "jev-router-usage.jsonl").read_text()
        self.assertNotIn("slide", log)


if __name__ == "__main__":
    unittest.main()
