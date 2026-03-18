{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.gastown-gui;
  isAbsolutePath = value: builtins.match "^/.*" value != null;
in {
  options.services.gastown-gui = {
    enable = lib.mkEnableOption "gastown-gui web service";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.default;
      description = "Gastown GUI package to run.";
    };

    gtPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = "Optional package that provides the gt binary.";
    };

    beadsPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = "Optional package that provides the beads binary.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open firewall for the configured port.";
    };

    host = lib.mkOption {
      type = lib.types.nonEmptyStr;
      default = "127.0.0.1";
      description = "Host interface for the gastown-gui HTTP server.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 7667;
      description = "Port for the gastown-gui HTTP server.";
    };

    user = lib.mkOption {
      type = lib.types.nonEmptyStr;
      default = "gastown";
      description = "User to run service under";
    };

    group = lib.mkOption {
      type = lib.types.nonEmptyStr;
      default = "gastown";
      description = "Group to run service under";
    };

    createUser = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Create the configured service user when enabled.";
    };

    createGroup = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Create the configured service group when enabled.";
    };

    gtRoot = lib.mkOption {
      type = lib.types.nullOr lib.types.nonEmptyStr;
      default = null;
      example = "/var/lib/gastown/gt";
      description = "Optional GT_ROOT path passed to gastown-gui.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = "Extra environment variables for the gastown-gui service.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.gtRoot == null || isAbsolutePath cfg.gtRoot;
        message = "services.gastown-gui.gtRoot must be an absolute path when set.";
      }
    ];

    users.groups = lib.mkIf cfg.createGroup {
      "${cfg.group}" = { };
    };

    users.users = lib.mkIf cfg.createUser {
      "${cfg.user}" = {
        isSystemUser = true;
        group = cfg.group;
        description = "Gastown GUI service account";
        home = "/var/lib/gastown-gui";
      };
    };

    networking.firewall.allowedTCPPorts = lib.optionals cfg.openFirewall [ cfg.port ];

    systemd.services.gastown-gui = {
      description = "Gastown GUI";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path =
        [ pkgs.nodejs ]
        ++ lib.optional (cfg.gtPackage != null) cfg.gtPackage
        ++ lib.optional (cfg.beadsPackage != null) cfg.beadsPackage;
      environment = cfg.environment // lib.optionalAttrs (cfg.gtRoot != null) {
        GT_ROOT = toString cfg.gtRoot;
      };
      serviceConfig = {
        Type = "simple";
        ExecStart = "${lib.getExe cfg.package} start --host ${cfg.host} --port ${toString cfg.port}";
        DynamicUser = false;
        User = cfg.user;
        Group = cfg.group;
        StateDirectory = "gastown-gui";
        Restart = "on-failure";
        RestartSec = "2s";
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "full";
        ProtectControlGroups = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectClock = true;
        ProtectHostname = true;
        RestrictSUIDSGID = true;
        RestrictRealtime = true;
        LockPersonality = true;
        SystemCallArchitectures = "native";
        CapabilityBoundingSet = [ "" ];
        AmbientCapabilities = [ ];
        UMask = "0077";
      };
    };
  };
}
