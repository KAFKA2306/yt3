import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Mock the dependencies before they are imported by the agent
sys.modules["langchain_google_genai"] = MagicMock()
sys.modules["langchain_google_genai"].ChatGoogleGenerativeAI = MagicMock()

# Now import the agent
from src.agents.trend import TrendAgent
from src.asset import AssetStore

class TestTrendAgent(unittest.TestCase):
    def test_run(self):
        store = MagicMock(spec=AssetStore)
        agent = TrendAgent(store)
        
        # Mock the LLM response
        mock_response = MagicMock()
        mock_response.content = """
        [
            {
                "topic": "AI Market Crash",
                "reason": "Sudden drop in GPU stocks",
                "search_query": "AI stocks crash reason",
                "hypeness_score": 9
            },
            {
                "topic": "New Python Version",
                "reason": "Python 4.0 rumors",
                "search_query": "Python 4.0 release date",
                "hypeness_score": 7
            }
        ]
        """
        agent.llm.invoke.return_value = mock_response
        
        # Run
        result = agent.run(category="Tech", region="US")
        
        # Verify
        print(f"Result: {result}")
        self.assertEqual(result["topic"], "AI Market Crash")
        self.assertEqual(result["search_query"], "AI stocks crash reason")
        store.log_input.assert_called()
        store.log_output.assert_called()

if __name__ == "__main__":
    unittest.main()
