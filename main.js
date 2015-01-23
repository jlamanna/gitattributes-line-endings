/* global define, brackets, window, $ */

/** Reads a .gitattributes file and sets the line endings accordingly */

define(function(require, exports, module) {
    'use strict';
    
    var minimatch = require('./lib/minimatch');
    var DocumentManager = brackets.getModule('document/DocumentManager'),
        PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
        FileUtils = brackets.getModule("file/FileUtils"),
        FileSystem = brackets.getModule("filesystem/FileSystem"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        CommandManager = brackets.getModule("command/CommandManager"),
        Menus = brackets.getModule("command/Menus"),
        prefs = PreferencesManager.getExtensionPrefs('line-endings'),
    	_preferences,
        _command;
    
    
    var CONFIG_FILE = '.gitattributes';
    
    function parseGitAttributes(content)
    {
        content = removeComments(content);
        
        var patRe = /^([^\s]*).*eol=(lf|crlf)/i;
        var lines = content.split(/\n/);
        var eolPatterns = { };
        $.each(lines, function(i, line) {
            var m = line.trim().match(patRe);
            if (m) {
                eolPatterns[m[1]] = m[2].toLowerCase();
            }
        });
        
        return eolPatterns;
    };
    
    function removeComments(str) {
        str = str || '';
        str = str.replace(/#.*/g, '');
        
        return str;
    };
    
    function _readConfig(dir, configFileName) {
        var result = new $.Deferred(),
            file;
        configFileName = configFileName || CONFIG_FILE;
        file = FileSystem.getFileForPath(dir + configFileName);
        file.read(function (err, content) {
            if (!err) {
                var config;
                try {
                    config = parseGitAttributes(content);
                } catch (e) {
                    console.error("error parsing " + file.fullPath + ". Details: " + e);
                    result.reject(e);
                    return;
                }
                var baseConfigResult = $.Deferred();
                baseConfigResult.resolve({});
                
                baseConfigResult.done( function (baseConfig) {
                    result.resolve(config);
                }).fail(function (e) {
                    result.reject(e);
                });
            } else {
                result.reject(err);
            }
        });
        return result.promise();
    }
    
    function _lookupAndLoad(root, dir, readConfig) {
        var deferred = new $.Deferred(),
            done = false,
            cdir = dir,
            file,
            iter = {
                next: function () {
                    if (done) {
                        return;
                    }
                    readConfig(root + cdir)
                        .then(function (cfg) {
                            this.stop(cfg);
                        }.bind(this))
                        .fail(function () {
                            if (!cdir) {
                                this.stop({});
                            }
                            if (!done) {
                                cdir = FileUtils.getDirectoryPath(cdir.substring(0, cdir.length - 1));
                                this.next();
                            }
                        }.bind(this));
                },
                stop: function (cfg) {
                    deferred.resolve(cfg);
                    done = true;
                }
            };
        if (cdir === undefined || cdir === null) {
            deferred.resolve({});
        } else {
            iter.next();
        }
        return deferred.promise();
    }
    
    
    
    // List of globs + line ending type
    var _lineEndings = prefs.get('patterns');
    
    var getBracketsLineEndings = function(eol) {
        switch (eol) {
            case "lf":
                return FileUtils.LINE_ENDINGS_LF;
            case "crlf":
                return FileUtils.LINE_ENDINGS_CRLF;
            default:
                return FileUtils.getPlatformLineEndings();
        }
    };

    var commandId          = "jlamanna.gitattributes-line-endings.toggle";
    var preferencesId      = "jlamanna.gitattributes-line-endings";
    var defaultPreferences = { checked: true };

    
    // --- State Variables ---
    

    function onCommandExecuted() {
        if (!_command.getChecked()) {
            _command.setChecked(true);
        } else {
            _command.setChecked(false);
        }
    }

    function loadPreferences() {
        _preferences = PreferencesManager.getExtensionPrefs(preferencesId);
        _preferences.definePreference("checked", "boolean", defaultPreferences["checked"]);
    }

    function onCheckedStateChange() {
        _preferences.set("checked", Boolean(_command.getChecked()));
    }

    function loadCommand() {
        _command = CommandManager.get(commandId);
        
        if (!_command) {
            _command = CommandManager.register("Enable GitAttributes Line Endings", commandId, onCommandExecuted);
        } else {
            _command._commandFn = onCommandExecuted;
        }

        $(_command).on("checkedStateChange", onCheckedStateChange);
        
        // Apply preferences
        _command.setChecked(_preferences.get("checked"));
    }

    function unloadCommand() {
        _command.setChecked(false);
        $(_command).off("checkedStateChange", onCheckedStateChange);
        _command._commandFn = null;
    }

    
    function loadMenuItem() {
        Menus.getMenu("view-menu").addMenuItem(commandId, "");
    }

    function unloadMenuItem() {
        Menus.getMenu("view-menu").removeMenuItem(commandId);
    }

    loadPreferences();
    loadCommand();
    loadMenuItem();
                
    $(DocumentManager).on('documentSaved', function(evt, doc) {
        var enabled = _preferences.get('checked');
        if (!enabled) {
            return;
        }
        var fullPath = doc.file.fullPath;
        var projectRootEntry = ProjectManager.getProjectRoot();
        var rootPath = projectRootEntry.fullPath;
        var relPath = FileUtils.getRelativeFilename(rootPath, fullPath);
        if (relPath) {
            relPath = FileUtils.getDirectoryPath(relPath);
            _lookupAndLoad(rootPath, relPath, _readConfig).done(function(cfg) {
                $.each(cfg, function(glob, eol) {
                    if (minimatch(fullPath, glob, { matchBase: true })) {
                        console.log('Saving ', fullPath, 'with line endings: ', eol);
                        var newText =  FileUtils.translateLineEndings(doc.getText(true), getBracketsLineEndings(eol));
                        FileUtils.writeText(doc.file, newText);
                    }
                });
            });
        }
    });
});
