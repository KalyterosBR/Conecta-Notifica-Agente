package banco

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// FotoMaxBytes é o mesmo teto aceito pela API.
const FotoMaxBytes = 512 * 1024

// FotoCadastro é uma foto de dbo.Pessoas, já conferida como JPEG.
type FotoCadastro struct {
	IDExterno string
	JPEG      []byte
	SHA256    string
}

// JpegDeCadastro reconhece o JPEG que o TopPortaria grava em Pessoas.foto
// (assinatura FFD8FF) e recusa blob vazio ou acima do teto.
func JpegDeCadastro(b []byte) bool {
	return len(b) >= 3 && len(b) <= FotoMaxBytes && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF
}

// PercorrerFotos lê dbo.Pessoas.foto uma linha por vez. A consulta é fixa e
// somente leitura; não usa a query configurável de alunos, para não misturar
// a imagem no lote de nome e cartão. O callback devolve a foto e pode
// descartá-la antes da próxima linha.
func (r *Repo) PercorrerFotos(ctx context.Context, fn func(FotoCadastro) error) error {
	rows, err := r.db.QueryContext(ctx, `
SELECT CONVERT(varchar(40), Codigo), foto
  FROM dbo.Pessoas
 WHERE foto IS NOT NULL AND DATALENGTH(foto) > 0
 ORDER BY Codigo`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var foto []byte
		if err := rows.Scan(&id, &foto); err != nil {
			return err
		}
		id = strings.TrimSpace(id)
		if id == "" || !JpegDeCadastro(foto) {
			if err := fn(FotoCadastro{IDExterno: id}); err != nil {
				return err
			}
			continue
		}
		sum := sha256.Sum256(foto)
		if err := fn(FotoCadastro{
			IDExterno: id,
			JPEG:      foto,
			SHA256:    hex.EncodeToString(sum[:]),
		}); err != nil {
			return err
		}
	}
	return rows.Err()
}
