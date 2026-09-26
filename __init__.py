import os

from flask import request

from CTFd.plugins import (
    register_admin_plugin_menu_bar,
    register_plugin_assets_directory,
    register_user_page_menu_bar,
)

from .admin import qa_admin
from .routes import qa

# The folder name CTFd loaded us from (e.g. "CTFd-qa-plugin" or "ctfd_qa_plugin"
# after a git clone), so asset URLs keep working whatever the folder is called.
PLUGIN_DIR = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
ASSETS_PATH = "/plugins/{}/assets/".format(PLUGIN_DIR)


def qa_asset(filename):
    return "{}{}{}".format(request.script_root, ASSETS_PATH, filename)


def load(app):
    # Create the qa_* tables (skipped if they already exist)
    app.db.create_all()

    app.register_blueprint(qa)
    app.register_blueprint(qa_admin)

    register_plugin_assets_directory(app, base_path=ASSETS_PATH)
    app.jinja_env.globals["qa_asset"] = qa_asset

    register_user_page_menu_bar("Q&A", "/qa")
    register_admin_plugin_menu_bar("Q&A", "/admin/qa")
