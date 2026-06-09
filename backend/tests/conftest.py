"""
tests/conftest.py — shared test fixtures
"""
import pytest
import sys
import os

# Make sure the backend root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
