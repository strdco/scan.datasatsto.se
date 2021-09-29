CREATE SCHEMA Scan;
GO
-- Events
---------
CREATE TABLE Scan.Events (
    EventID     int IDENTITY(1, 1) NOT NULL,
    [Event]     varchar(50) NOT NULL,
    EventSecret uniqueidentifier DEFAULT (NEWID()) NOT NULL,
    Expires     date DEFAULT (DATEADD(day, 365, SYSUTCDATETIME())) NOT NULL,
    CONSTRAINT PK_Scan_Events PRIMARY KEY CLUSTERED (EventID),
    CONSTRAINT UQ_Scan_Events UNIQUE ([Event])
);
GO
-- Identities
-------------
CREATE TABLE Scan.Identities (
    EventID     int NOT NULL,
    ID          bigint NOT NULL,
    Created     datetime2(3) NOT NULL,
    CONSTRAINT PK_Scan_Identities PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT FK_Scan_Identities_Events FOREIGN KEY (EventID) REFERENCES Scan.Events (EventID)
);
GO
-- Scans
--------
CREATE TABLE Scan.Scans (
    ID          bigint NOT NULL,
    Scanned     datetime2(3) NOT NULL,
    ReferenceCode varchar(20) NULL,
    CONSTRAINT PK_Scan_Scans PRIMARY KEY CLUSTERED (Id, Scanned),
    CONSTRAINT FK_Scan_Scans_Identities FOREIGN KEY (ID) REFERENCES Scan.Identities (ID)
);
GO

-------------------------------------------------------------------------------
--- Create a new event
-------------------------------------------------------------------------------

CREATE OR ALTER PROCEDURE Scan.New_Event
    @Event      varchar(50)
AS

SET NOCOUNT ON;

INSERT INTO Scan.Events ([Event])
OUTPUT inserted.EventSecret
VALUES (@Event);

GO

-------------------------------------------------------------------------------
--- Create a new identity
-------------------------------------------------------------------------------

CREATE OR ALTER PROCEDURE Scan.New_Identity
    @Event      varchar(50)
AS

SET NOCOUNT ON;

DECLARE @Done       bit=0,
        @ID         bigint,
        @Attempts   tinyint=0,
        @EventID    int=(SELECT EventID FROM Scan.Events WHERE [Event]=@Event);

IF (@EventID IS NULL) BEGIN;
    THROW 50001, 'Invalid event code', 1;
    RETURN;
END;

WHILE (@Done=0 AND @Attempts<100) BEGIN;
    BEGIN TRY;
        SET @ID=10000000000.+10000000000.*RAND(CHECKSUM(NEWID()));
        SET @Attempts=@Attempts+1;

        INSERT INTO Scan.Identities (ID, EventID, Created)
        VALUES (@ID, @EventID, SYSUTCDATETIME());

        SET @Done=1;
    END TRY
    BEGIN CATCH;
        SET @ID=NULL; 
        SET @Done=0;
    END CATCH;
END;

IF (@ID IS NOT NULL)
    SELECT @ID AS ID;

IF (@ID IS NULL)
    THROW 50001, 'You''re not going to believe this. But I think we ran out of identity numbers', 1;

GO

-------------------------------------------------------------------------------
--- Scan an identity
-------------------------------------------------------------------------------

CREATE OR ALTER PROCEDURE Scan.New_Scan
    @ID             bigint,
    @ReferenceCode  varchar(20)=NULL
AS

SET NOCOUNT ON;

INSERT INTO Scan.Scans (ID, Scanned, ReferenceCode)
OUTPUT inserted.ID
SELECT @ID, SYSUTCDATETIME(), @ReferenceCode
WHERE EXISTS (SELECT ID FROM Scan.Identities WHERE ID=@ID);

GO

-------------------------------------------------------------------------------
--- Fetch all scans for an event
-------------------------------------------------------------------------------

CREATE OR ALTER PROCEDURE Scan.Get_Scans
    @EventSecret        uniqueidentifier
AS

SELECT i.ID, s.Scanned, s.ReferenceCode AS Code
FROM Scan.Events AS e
INNER JOIN Scan.Identities AS i ON e.EventID=i.EventID
LEFT JOIN Scan.Scans AS s ON i.ID=s.ID
WHERE e.EventSecret=@EventSecret
ORDER BY s.Scanned;

GO

-------------------------------------------------------------------------------
--- Evict old identities and scans
-------------------------------------------------------------------------------

CREATE OR ALTER PROCEDURE Scan.Expire
AS

DECLARE @today date=SYSUTCDATETIME();

BEGIN TRANSACTION;

    DELETE s
    FROM Scan.Events AS e
    INNER JOIN Scan.Identities AS i ON e.EventID=i.EventID
    INNER JOIN Scan.Scans AS s ON i.ID=s.ID
    WHERE e.Expires<@today;

    DELETE i
    FROM Scan.Events AS e
    INNER JOIN Scan.Identities AS i ON e.EventID=i.EventID
    WHERE e.Expires<@today;

    DELETE e
    OUTPUT deleted.Event AS ExpiredEvent
    FROM Scan.Events AS e
    WHERE e.Expires<@today;

COMMIT TRANSACTION;

GO
