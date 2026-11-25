"""
Unit tests for Google Drive internal discussion hierarchy and pair sorting.
"""

from unittest.mock import patch, MagicMock
from backend.integrations.google_drive import ensure_internal_discussion_drive_hierarchy


def test_ensure_internal_discussion_drive_hierarchy_canonical_pair_sorting():
    with patch("backend.integrations.google_drive._get_service") as mock_get_service, \
         patch("backend.integrations.google_drive._find_or_create_folder") as mock_find_folder:

        mock_service = MagicMock()
        mock_get_service.return_value = mock_service
        mock_find_folder.side_effect = lambda name, parent: f"id_of_{name}"

        # Case 1: Caller = Shailesh, Teammate = Abhijeet
        res1 = ensure_internal_discussion_drive_hierarchy(
            teammate_name="Abhijeet",
            caller_name="Shailesh"
        )
        assert res1["member_folder_id"] == "id_of_Team_Syncs - Abhijeet & Shailesh"

        # Case 2: Caller = Abhijeet, Teammate = Shailesh
        res2 = ensure_internal_discussion_drive_hierarchy(
            teammate_name="Shailesh",
            caller_name="Abhijeet"
        )
        assert res2["member_folder_id"] == "id_of_Team_Syncs - Abhijeet & Shailesh"

        # Case 3: Single teammate without caller
        res3 = ensure_internal_discussion_drive_hierarchy(
            teammate_name="Abhijeet",
            phone="+919993202900"
        )
        assert res3["member_folder_id"] == "id_of_Abhijeet (+919993202900)"
