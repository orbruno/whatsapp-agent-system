"""
HTTP client for interacting with the WhatsApp Bridge REST API.
"""

import requests
from typing import Optional, Dict, Any, List


class WhatsAppAPI:
    """Client for the WhatsApp Bridge HTTP API."""

    def __init__(self, base_url: str = "http://localhost:3100"):
        self.base_url = base_url

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make a GET request to the API."""
        try:
            response = requests.get(f"{self.base_url}{path}", params=params)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            return {"success": False, "error": f"Request error: {str(e)}"}

    def _post(self, path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make a POST request to the API."""
        try:
            response = requests.post(f"{self.base_url}{path}", json=data)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            return {"success": False, "error": f"Request error: {str(e)}"}

    def list_chats(
        self,
        query: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """List WhatsApp chats."""
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        if query:
            params["query"] = query
        return self._get("/api/chats", params)

    def list_messages(
        self,
        chat_id: str,
        query: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        direction: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List messages in a chat."""
        params: Dict[str, Any] = {"chat_id": chat_id, "limit": limit, "offset": offset}
        if query:
            params["query"] = query
        if direction:
            params["direction"] = direction
        return self._get("/api/messages", params)

    def search_messages(
        self,
        query: str,
        chat_id: Optional[str] = None,
        limit: int = 20,
    ) -> Dict[str, Any]:
        """Search messages across chats."""
        params: Dict[str, Any] = {"q": query, "limit": limit}
        if chat_id:
            params["chat_id"] = chat_id
        return self._get("/api/search", params)

    def send_message(self, jid: str, text: str) -> Dict[str, Any]:
        """Send a message to a JID."""
        return self._post("/api/send", {"jid": jid, "text": text})

    def get_contacts(
        self,
        query: Optional[str] = None,
        limit: int = 20,
    ) -> Dict[str, Any]:
        """Get WhatsApp contacts."""
        params: Dict[str, Any] = {"limit": limit}
        if query:
            params["query"] = query
        return self._get("/api/contacts", params)

    def get_stats(self) -> Dict[str, Any]:
        """Get bridge statistics."""
        return self._get("/api/stats")
